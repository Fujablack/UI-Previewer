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
exports.cssPlugin = cssPlugin;
const esbuild = __importStar(require("esbuild"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const module_1 = require("module");
const url_1 = require("url");
const dynamicImport = new Function('p', 'return import(p)');
/** Matches CSS that still needs Tailwind compiled (v3 directives, v4 entry import, @apply). */
const TAILWIND_MARKERS = /@import\s+(url\()?["']tailwindcss|@tailwind\s+(base|components|utilities|variants)|@apply\s/;
// ---------- helpers ----------
/** Find an installed package by walking up from `root` (works in monorepos with hoisting). */
function findPackageDir(root, name) {
    let dir = root;
    for (;;) {
        const p = path.join(dir, 'node_modules', name);
        if (fs.existsSync(path.join(p, 'package.json')))
            return p;
        const up = path.dirname(dir);
        if (up === dir)
            return undefined;
        dir = up;
    }
}
/** Require `target`, trying the project first, then from next to each "host" package (strict pnpm layouts). */
function requireVia(root, target, hosts = []) {
    const tries = [root, ...hosts.map((h) => findPackageDir(root, h)).filter(Boolean)];
    let last;
    for (const base of tries) {
        try {
            return (0, module_1.createRequire)(path.join(base, 'package.json'))(target);
        }
        catch (e) {
            last = e;
        }
    }
    throw last;
}
const TW_HOSTS = ['tailwindcss', '@tailwindcss/vite', '@tailwindcss/postcss', '@tailwindcss/cli', '@tailwindcss/webpack'];
function loadPostcss(root) {
    return requireVia(root, 'postcss', TW_HOSTS);
}
// ---------- 1) the project's own PostCSS config (any common format) ----------
const CONFIG_FILES = [
    'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts', 'postcss.config.cts', 'postcss.config.mts',
    '.postcssrc', '.postcssrc.json', '.postcssrc.js', '.postcssrc.cjs', '.postcssrc.mjs', '.postcssrc.ts', '.postcssrc.cts', '.postcssrc.mts',
];
async function readConfigModule(file) {
    const ext = path.extname(file);
    const req = (0, module_1.createRequire)(file);
    if (file.endsWith('.postcssrc') || ext === '.json')
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (ext === '.ts' || ext === '.cts' || ext === '.mts') {
        const out = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18' });
        const m = { exports: {} };
        new Function('require', 'module', 'exports', '__dirname', '__filename', out.code)(req, m, m.exports, path.dirname(file), file);
        return m.exports;
    }
    if (ext === '.mjs')
        return dynamicImport((0, url_1.pathToFileURL)(file).href);
    try {
        return req(file);
    }
    catch {
        return dynamicImport((0, url_1.pathToFileURL)(file).href);
    }
}
async function configTransform(root) {
    let cfg;
    let cfgFile = CONFIG_FILES.map((f) => path.join(root, f)).find(fs.existsSync);
    if (cfgFile) {
        const mod = await readConfigModule(cfgFile);
        cfg = mod?.default ?? mod;
    }
    else {
        try {
            cfg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).postcss;
        }
        catch { /* none */ }
        cfgFile = path.join(root, 'package.json');
    }
    if (!cfg)
        return undefined;
    if (typeof cfg === 'function')
        cfg = await cfg({ env: 'development', cwd: root, file: cfgFile });
    const req = (0, module_1.createRequire)(path.join(root, 'package.json'));
    const use = (name, opts) => {
        const m = req(name);
        const fn = m.default ?? m;
        const o = opts === true || opts == null ? {} : opts;
        if (name === '@tailwindcss/postcss' && !o.base)
            o.base = root; // v4 scans from `base`
        return typeof fn === 'function' ? fn(o) : fn;
    };
    const list = cfg.plugins ?? [];
    const plugins = Array.isArray(list)
        ? list.map((p) => (typeof p === 'string' ? use(p, {}) : Array.isArray(p) ? use(p[0], p[1]) : p))
        : Object.entries(list).filter(([, o]) => o !== false).map(([n, o]) => use(n, o));
    if (!plugins.length)
        return undefined;
    const processor = loadPostcss(root)(plugins);
    return async (source, file) => (await processor.process(source, { from: file })).css;
}
// ---------- 2) Tailwind without any PostCSS config (e.g. Vite + @tailwindcss/vite) ----------
async function tailwindTransform(root) {
    const twDir = findPackageDir(root, 'tailwindcss');
    if (!twDir)
        return undefined;
    const major = Number(String(JSON.parse(fs.readFileSync(path.join(twDir, 'package.json'), 'utf8')).version).split('.')[0]);
    if (major >= 4) {
        // a) official PostCSS plugin, if installed
        if (findPackageDir(root, '@tailwindcss/postcss')) {
            const plugin = requireVia(root, '@tailwindcss/postcss');
            const processor = loadPostcss(root)([(plugin.default ?? plugin)({ base: root })]);
            return async (source, file) => (await processor.process(source, { from: file })).css;
        }
        // b) the compiler that ships with the Vite / CLI plugins
        const node = requireVia(root, '@tailwindcss/node', TW_HOSTS);
        const oxide = requireVia(root, '@tailwindcss/oxide', TW_HOSTS);
        return async (source, file) => {
            const compiler = await node.compile(source, { base: path.dirname(file), onDependency: () => { } });
            let scanner;
            if (compiler.sources !== undefined || compiler.root !== undefined) {
                const sources = [];
                if (compiler.root !== 'none') {
                    const r = compiler.root;
                    sources.push(r ? { base: r.base, pattern: r.pattern, negated: false } : { base: root, pattern: '**/*', negated: false });
                }
                for (const s of compiler.sources ?? [])
                    sources.push(s);
                scanner = new oxide.Scanner({ sources });
            }
            else {
                // older v4 API
                scanner = new oxide.Scanner({ detectSources: { base: root }, sources: (compiler.globs ?? []).map((g) => ({ base: g.base, pattern: g.pattern })) });
            }
            return compiler.build(scanner.scan());
        };
    }
    // v3: plugin applied directly (reads tailwind.config.* from cwd)
    const tw = requireVia(root, 'tailwindcss');
    const processor = loadPostcss(root)([(tw.default ?? tw)()]);
    return async (source, file) => (await processor.process(source, { from: file })).css;
}
// ---------- the esbuild plugin ----------
function cssPlugin(root, notes) {
    return {
        name: 'preview-css',
        setup(build) {
            let main;
            let tw;
            const safe = async (label, f) => {
                try {
                    return await f();
                }
                catch (e) {
                    notes.push(`${label} unavailable: ${String(e?.message ?? e).split('\n')[0]}`);
                    return undefined;
                }
            };
            build.onLoad({ filter: /\.css$/ }, async (a) => {
                if (a.path.includes('node_modules'))
                    return;
                let css = fs.readFileSync(a.path, 'utf8');
                const prev = process.cwd();
                try {
                    process.chdir(root); // Tailwind v3 resolves its config relative to cwd
                    main ??= safe('PostCSS config', () => configTransform(root));
                    const t1 = await main;
                    if (t1)
                        css = await t1(css, a.path);
                    if (TAILWIND_MARKERS.test(css)) {
                        tw ??= safe('Tailwind', () => tailwindTransform(root));
                        const t2 = await tw;
                        if (t2)
                            css = await t2(css, a.path);
                    }
                }
                catch (e) {
                    notes.push(`Styles in ${path.basename(a.path)} were not fully processed: ${String(e?.message ?? e).split('\n')[0]}`);
                }
                finally {
                    process.chdir(prev);
                }
                return { contents: css, loader: a.path.endsWith('.module.css') ? 'local-css' : 'css', resolveDir: path.dirname(a.path) };
            });
            // Never let an unresolvable CSS @import blank the whole preview.
            build.onResolve({ filter: /.*/ }, async (a) => {
                if (a.kind !== 'import-rule' || a.pluginData === 'css-skip')
                    return;
                const r = await build.resolve(a.path, { resolveDir: a.resolveDir, kind: a.kind, pluginData: 'css-skip' });
                if (r.errors.length) {
                    notes.push(`Skipped CSS import "${a.path}" (could not be resolved)`);
                    return { path: a.path, namespace: 'css-empty' };
                }
                return { path: r.path, external: r.external };
            });
            build.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: '', loader: 'css' }));
        },
    };
}
//# sourceMappingURL=css.js.map