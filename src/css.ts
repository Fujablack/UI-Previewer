import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const dynamicImport = new Function('p', 'return import(p)') as (p: string) => Promise<any>;

/** Matches CSS that still needs Tailwind compiled (v3 directives, v4 entry import, @apply). */
const TAILWIND_MARKERS = /@import\s+(url\()?["']tailwindcss|@tailwind\s+(base|components|utilities|variants)|@apply\s/;

type Transform = (source: string, file: string) => Promise<string>;

// ---------- helpers ----------

/** Find an installed package by walking up from `root` (works in monorepos with hoisting). */
function findPackageDir(root: string, name: string): string | undefined {
  let dir = root;
  for (;;) {
    const p = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Require `target`, trying the project first, then from next to each "host" package (strict pnpm layouts). */
function requireVia(root: string, target: string, hosts: string[] = []): any {
  const tries = [root, ...hosts.map((h) => findPackageDir(root, h)).filter(Boolean) as string[]];
  let last: unknown;
  for (const base of tries) {
    try { return createRequire(path.join(base, 'package.json'))(target); } catch (e) { last = e; }
  }
  throw last;
}

const TW_HOSTS = ['tailwindcss', '@tailwindcss/vite', '@tailwindcss/postcss', '@tailwindcss/cli', '@tailwindcss/webpack'];

function loadPostcss(root: string): any {
  return requireVia(root, 'postcss', TW_HOSTS);
}

// ---------- 1) the project's own PostCSS config (any common format) ----------

const CONFIG_FILES = [
  'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs', 'postcss.config.ts', 'postcss.config.cts', 'postcss.config.mts',
  '.postcssrc', '.postcssrc.json', '.postcssrc.js', '.postcssrc.cjs', '.postcssrc.mjs', '.postcssrc.ts', '.postcssrc.cts', '.postcssrc.mts',
];

async function readConfigModule(file: string): Promise<any> {
  const ext = path.extname(file);
  const req = createRequire(file);
  if (file.endsWith('.postcssrc') || ext === '.json') return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (ext === '.ts' || ext === '.cts' || ext === '.mts') {
    const out = esbuild.transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'node18' });
    const m: any = { exports: {} };
    new Function('require', 'module', 'exports', '__dirname', '__filename', out.code)(req, m, m.exports, path.dirname(file), file);
    return m.exports;
  }
  if (ext === '.mjs') return dynamicImport(pathToFileURL(file).href);
  try { return req(file); } catch { return dynamicImport(pathToFileURL(file).href); }
}

async function configTransform(root: string): Promise<Transform | undefined> {
  let cfg: any;
  let cfgFile = CONFIG_FILES.map((f) => path.join(root, f)).find(fs.existsSync);
  if (cfgFile) {
    const mod = await readConfigModule(cfgFile);
    cfg = mod?.default ?? mod;
  } else {
    try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).postcss; } catch { /* none */ }
    cfgFile = path.join(root, 'package.json');
  }
  if (!cfg) return undefined;
  if (typeof cfg === 'function') cfg = await cfg({ env: 'development', cwd: root, file: cfgFile });

  const req = createRequire(path.join(root, 'package.json'));
  const use = (name: string, opts: any) => {
    const m = req(name);
    const fn = m.default ?? m;
    const o = opts === true || opts == null ? {} : opts;
    if (name === '@tailwindcss/postcss' && !o.base) o.base = root; // v4 scans from `base`
    return typeof fn === 'function' ? fn(o) : fn;
  };
  const list = cfg.plugins ?? [];
  const plugins = Array.isArray(list)
    ? list.map((p: any) => (typeof p === 'string' ? use(p, {}) : Array.isArray(p) ? use(p[0], p[1]) : p))
    : Object.entries(list).filter(([, o]) => o !== false).map(([n, o]) => use(n, o));
  if (!plugins.length) return undefined;

  const processor = loadPostcss(root)(plugins);
  return async (source, file) => (await processor.process(source, { from: file })).css;
}

// ---------- 2) Tailwind without any PostCSS config (e.g. Vite + @tailwindcss/vite) ----------

async function tailwindTransform(root: string): Promise<Transform | undefined> {
  const twDir = findPackageDir(root, 'tailwindcss');
  if (!twDir) return undefined;
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
      const compiler = await node.compile(source, { base: path.dirname(file), onDependency: () => {} });
      let scanner: any;
      if (compiler.sources !== undefined || compiler.root !== undefined) {
        const sources: any[] = [];
        if (compiler.root !== 'none') {
          const r = compiler.root;
          sources.push(r ? { base: r.base, pattern: r.pattern, negated: false } : { base: root, pattern: '**/*', negated: false });
        }
        for (const s of compiler.sources ?? []) sources.push(s);
        scanner = new oxide.Scanner({ sources });
      } else {
        // older v4 API
        scanner = new oxide.Scanner({ detectSources: { base: root }, sources: (compiler.globs ?? []).map((g: any) => ({ base: g.base, pattern: g.pattern })) });
      }
      return compiler.build(scanner.scan());
    };
  }

  // v3: plugin applied directly (reads tailwind.config.* from cwd)
  const tw = requireVia(root, 'tailwindcss');
  const processor = loadPostcss(root)([(tw.default ?? tw)()]);
  return async (source, file) => (await processor.process(source, { from: file })).css;
}

// ---------- Sass / Less / Stylus (compiled with the project's own installed compiler) ----------

const PREPROCESSORS = /\.(scss|sass|less|styl|stylus)$/;

async function preprocess(root: string, file: string): Promise<string> {
  const dir = path.dirname(file);
  const ext = path.extname(file).slice(1);
  const nm = path.join(root, 'node_modules');
  const paths = [dir, root, nm];

  if (ext === 'scss' || ext === 'sass') {
    let sass: any;
    try { sass = requireVia(root, 'sass'); } catch (e: any) {
      if (e?.code !== 'MODULE_NOT_FOUND') throw e;
      sass = requireVia(root, 'sass-embedded');
    }
    if (typeof sass.compile === 'function') {
      const tilde = { findFileUrl: (url: string) => (url.startsWith('~') ? new URL(url.slice(1), pathToFileURL(nm + path.sep)) : null) };
      return sass.compile(file, { loadPaths: paths, importers: [tilde], quietDeps: true, logger: sass.Logger?.silent }).css;
    }
    return sass.renderSync({ file, includePaths: paths }).css.toString(); // very old sass
  }
  if (ext === 'less') {
    const less = requireVia(root, 'less');
    const out = await (less.default ?? less).render(fs.readFileSync(file, 'utf8'), { filename: file, paths, javascriptEnabled: true });
    return out.css;
  }
  const stylus = requireVia(root, 'stylus');
  return new Promise((resolve, reject) =>
    stylus(fs.readFileSync(file, 'utf8')).set('filename', file).set('paths', paths).render((e: any, css: string) => (e ? reject(e) : resolve(css)))
  );
}

// ---------- the esbuild plugin ----------

export function cssPlugin(root: string, notes: string[]): esbuild.Plugin {
  return {
    name: 'preview-css',
    setup(build) {
      let main: Promise<Transform | undefined> | undefined;
      let tw: Promise<Transform | undefined> | undefined;
      const safe = async (label: string, f: () => Promise<Transform | undefined>) => {
        try { return await f(); } catch (e: any) { notes.push(`${label} unavailable: ${String(e?.message ?? e).split('\n')[0]}`); return undefined; }
      };

      // PostCSS config -> Tailwind fallback, applied to any plain CSS text
      const run = async (css: string, file: string): Promise<string> => {
        const prev = process.cwd();
        try {
          process.chdir(root); // Tailwind v3 resolves its config relative to cwd
          main ??= safe('PostCSS config', () => configTransform(root));
          const t1 = await main;
          if (t1) css = await t1(css, file);
          if (TAILWIND_MARKERS.test(css)) {
            tw ??= safe('Tailwind', () => tailwindTransform(root));
            const t2 = await tw;
            if (t2) css = await t2(css, file);
          }
        } catch (e: any) {
          notes.push(`Styles in ${path.basename(file)} were not fully processed: ${String(e?.message ?? e).split('\n')[0]}`);
        } finally {
          process.chdir(prev);
        }
        return css;
      };
      const loaderFor = (file: string) => (/\.module\.[a-z]+$/.test(file) ? 'local-css' : 'css');

      build.onLoad({ filter: /\.css$/ }, async (a) => {
        if (a.path.includes('node_modules')) return;
        const css = await run(fs.readFileSync(a.path, 'utf8'), a.path);
        return { contents: css, loader: loaderFor(a.path), resolveDir: path.dirname(a.path) };
      });

      build.onLoad({ filter: PREPROCESSORS }, async (a) => {
        let css: string;
        try {
          css = await preprocess(root, a.path);
        } catch (e: any) {
          const ext = path.extname(a.path).slice(1);
          const pkg = ext === 'scss' || ext === 'sass' ? 'sass' : ext === 'less' ? 'less' : 'stylus';
          notes.push(
            e?.code === 'MODULE_NOT_FOUND'
              ? `${path.basename(a.path)} skipped: "${pkg}" is not installed in this project`
              : `${path.basename(a.path)} skipped: ${String(e?.message ?? e).split('\n')[0]}`
          );
          return { contents: '', loader: loaderFor(a.path) }; // preview still renders, just without these styles
        }
        css = await run(css, a.path);
        return { contents: css, loader: loaderFor(a.path), resolveDir: path.dirname(a.path) };
      });

      // Never let an unresolvable CSS @import blank the whole preview.
      build.onResolve({ filter: /.*/ }, async (a) => {
        if (a.kind !== 'import-rule' || a.pluginData === 'css-skip') return;
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
