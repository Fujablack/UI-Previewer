"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundle = bundle;
const esbuild = __importStar(require("esbuild"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const css_1 = require("./css");
const STUBS = {
    'next/image': 'next-image',
    'next/legacy/image': 'next-image',
    'next/link': 'next-link',
    'next/navigation': 'next-navigation',
    'next/router': 'next-router',
    'next/head': 'next-head',
    'next/dynamic': 'next-dynamic',
    'next/script': 'next-script',
    'react-redux': 'react-redux', // no store needed: components just get dummy state
    'preview-deep': 'deep',
    'preview-patch': 'patch',
};
const STUB_DIR = path.join(__dirname, '..', 'stubs');
const IMG = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
};
/** Replace Next.js-only modules (next/image, next/link, ...) with browser-friendly stubs. */
function nextStubs(root) {
    return {
        name: 'next-stubs',
        setup(build) {
            build.onResolve({ filter: /^(next\/(image|legacy\/image|link|navigation|router|head|dynamic|script)|react-redux|preview-deep|preview-patch)$/ }, (a) => ({
                path: STUBS[a.path],
                namespace: 'preview-stub',
            }));
            build.onResolve({ filter: /^react$/ }, (a) => {
                const fromProject = a.namespace === 'file' && !a.importer.includes('node_modules');
                return fromProject ? { path: 'react-patched', namespace: 'preview-stub' } : undefined;
            });
            build.onLoad({ filter: /.*/, namespace: 'preview-stub' }, (a) => ({
                contents: fs.readFileSync(path.join(STUB_DIR, a.path + '.jsx'), 'utf8'),
                loader: 'jsx',
                resolveDir: root,
            }));
        },
    };
}
/** `import hero from './hero.png'` -> { src, width, height } like Next gives, usable as string too. */
function imageImports() {
    return {
        name: 'image-imports',
        setup(build) {
            build.onResolve({ filter: IMG }, async (a) => {
                if (a.kind === 'url-token' || a.pluginData === 'img-skip')
                    return; // CSS url() uses default loader
                const r = await build.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: 'img-skip' });
                if (r.errors.length)
                    return { errors: r.errors };
                return { path: r.path, namespace: 'preview-img' };
            });
            build.onLoad({ filter: /.*/, namespace: 'preview-img' }, (a) => {
                const ext = path.extname(a.path).slice(1).toLowerCase();
                const src = `data:${MIME[ext] ?? 'application/octet-stream'};base64,${fs.readFileSync(a.path).toString('base64')}`;
                return {
                    contents: `const src = ${JSON.stringify(src)}; export default { src, width: 0, height: 0, toString() { return src; } };`,
                    loader: 'js',
                };
            });
        },
    };
}
function loadEnv(root) {
    const env = { NODE_ENV: 'development' };
    for (const f of ['.env', '.env.development', '.env.local', '.env.development.local']) {
        const p = path.join(root, f);
        if (!fs.existsSync(p))
            continue;
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && /^(NEXT_PUBLIC_|REACT_APP_|VITE_)/.test(m[1]))
                env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    }
    return env;
}
/** Detect UI libraries that need a provider and wrap the preview in one automatically. */
function autoProviders(root) {
    const pkgJson = (pkg) => {
        try {
            return JSON.parse(fs.readFileSync(path.join(root, 'node_modules', pkg, 'package.json'), 'utf8'));
        }
        catch {
            return undefined;
        }
    };
    const imports = [];
    const list = [];
    const mantine = pkgJson('@mantine/core');
    if (mantine) {
        const major = Number(String(mantine.version).split('.')[0]);
        imports.push("import { MantineProvider } from '@mantine/core';");
        if (major >= 7 && fs.existsSync(path.join(root, 'node_modules/@mantine/core/styles.css'))) {
            imports.push("import '@mantine/core/styles.css';");
        }
        list.push(major >= 7 ? "[MantineProvider, { defaultColorScheme: 'light' }]" : "[MantineProvider, { withGlobalStyles: true, withNormalizeCSS: true }]");
    }
    const router = pkgJson('react-router-dom');
    if (router) {
        imports.push("import { MemoryRouter } from 'react-router-dom';");
        list.push('[MemoryRouter, {}]');
    }
    if (pkgJson('@tanstack/react-query')) {
        imports.push("import { QueryClient, QueryClientProvider } from '@tanstack/react-query';");
        list.push('[QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }]');
    }
    return { imports, list: '[' + list.join(', ') + ']' };
}
async function bundle(inp) {
    const { root } = inp;
    const setup = path.join(root, '.vscode', 'component-preview.setup.tsx');
    const hasSetup = fs.existsSync(setup);
    const tsconfig = ['tsconfig.app.json', 'tsconfig.json'].map((f) => path.join(root, f)).find(fs.existsSync);
    const auto = autoProviders(root);
    const entry = [
        "import 'preview-patch';", // must stay first: makes missing-Provider contexts harmless
        "import * as React from 'react';",
        "import { createRoot } from 'react-dom/client';",
        ...(inp.globalCss ?? []).map((c) => 'import ' + JSON.stringify(path.resolve(root, c)) + ';'),
        ...auto.imports,
        'import * as Mod from ' + JSON.stringify(inp.fileName) + ';',
        hasSetup ? 'import Wrapper from ' + JSON.stringify(setup) + ';' : 'const Wrapper = ({ children }) => children;',
        'const autoProviders = ' + auto.list + ';',
        `const AutoProviders = ({ children }) => autoProviders.reduceRight((el, [P, props]) => React.createElement(P, props, el), children);`,
        'const Component = Mod[' + JSON.stringify(inp.exportName) + '];',
        'const raw = ' + JSON.stringify(inp.props) + ';',
        `function revive(v) {
      if (Array.isArray(v)) return v.map(revive);
      if (v && typeof v === 'object') {
        if ('$$fn' in v) return (...a) => console.log('[preview] ' + v.$$fn + ' called', a);
        if ('$$date' in v) return new Date(v.$$date);
        if ('$$el' in v) return React.createElement('div', { style: { padding: 8, border: '1px dashed #888', borderRadius: 4 } }, 'Element');
        return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
      }
      return v;
    }`,
        `class Boundary extends React.Component {
      state = { error: null, lenient: false };
      static getDerivedStateFromError(error) { return { error }; }
      componentDidCatch() {
        // First failure: retry once with every missing Provider context faked
        if (!this.state.lenient) { window.__PV_ALL = true; this.setState({ lenient: true, error: null }); }
      }
      render() {
        if (this.state.error) {
          const msg = String(this.state.error.message);
          return React.createElement('pre', { style: { color: '#c00', whiteSpace: 'pre-wrap' } },
            String(this.state.error.stack || this.state.error) +
            (/provider|context/i.test(msg) ? '\\n\\nHint: this component needs a provider. Add it in .vscode/component-preview.setup.tsx (default-export a wrapper component).' : ''));
        }
        return React.createElement(React.Fragment, { key: this.state.lenient ? 1 : 0 }, this.props.children(this.state.lenient));
      }
    }`,
        `createRoot(document.getElementById('root')).render(
      <Boundary>{(lenient) => lenient ? <Wrapper><Component {...revive(raw)} /></Wrapper> : <AutoProviders><Wrapper><Component {...revive(raw)} /></Wrapper></AutoProviders>}</Boundary>
    );`,
    ].join('\n');
    const notes = [];
    try {
        const result = await esbuild.build({
            stdin: { contents: entry, resolveDir: root, loader: 'tsx', sourcefile: 'preview-entry.tsx' },
            absWorkingDir: root,
            outdir: 'out',
            write: false,
            bundle: true,
            format: 'iife',
            platform: 'browser',
            jsx: 'automatic',
            sourcemap: 'inline',
            logLevel: 'silent',
            tsconfig,
            plugins: [nextStubs(root), imageImports(), (0, css_1.cssPlugin)(root, notes)],
            conditions: ['style'], // lets CSS packages ("style" export condition) resolve
            define: { 'process.env': JSON.stringify(loadEnv(root)), global: 'window' },
            loader: {
                '.module.css': 'local-css', '.css': 'css',
                '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.gif': 'dataurl',
                '.webp': 'dataurl', '.svg': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl',
            },
        });
        const js = result.outputFiles.find((f) => f.path.endsWith('.js'))?.text ?? '';
        const css = result.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
        return { js, css, notes: [...new Set(notes)] };
    }
    catch (e) {
        if (e?.errors) {
            const msgs = await esbuild.formatMessages(e.errors, { kind: 'error', color: false });
            throw new Error(msgs.join('\n'));
        }
        throw e;
    }
}
//# sourceMappingURL=bundler.js.map