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
exports.generateProps = generateProps;
const ts = __importStar(require("typescript"));
const path = __importStar(require("path"));
const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#c7c7d1"/><text x="50%" y="50%" fill="#fff" font-size="14" text-anchor="middle" dy=".3em">image</text></svg>');
function createProgram(fileName) {
    let options = {
        jsx: ts.JsxEmit.Preserve,
        allowJs: true,
        esModuleInterop: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
    };
    const dir = path.dirname(fileName);
    // Vite-style projects keep real options in tsconfig.app.json
    const configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.app.json') ??
        ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json');
    if (configPath) {
        const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, path.dirname(configPath));
        options = { ...parsed.options, allowJs: true, skipLibCheck: true, noEmit: true };
    }
    return ts.createProgram([fileName], options);
}
function generateProps(fileName, exportName, fillOptional) {
    const program = createProgram(fileName);
    const checker = program.getTypeChecker();
    const sf = program.getSourceFile(fileName);
    if (!sf)
        throw new Error('Could not load file into the TypeScript program.');
    const modSym = checker.getSymbolAtLocation(sf);
    if (!modSym)
        return {};
    let sym = checker.getExportsOfModule(modSym).find((s) => s.name === exportName);
    if (!sym)
        return {};
    if (sym.flags & ts.SymbolFlags.Alias)
        sym = checker.getAliasedSymbol(sym);
    const loc = sym.valueDeclaration ?? sf;
    const compType = checker.getTypeOfSymbolAtLocation(sym, loc);
    const ctx = { checker, loc, fillOptional };
    let propsType;
    const calls = compType.getCallSignatures();
    if (calls.length) {
        const p = calls[0].getParameters()[0];
        if (p)
            propsType = checker.getTypeOfSymbolAtLocation(p, loc);
    }
    else {
        const ctor = compType.getConstructSignatures()[0]; // class components
        const pp = ctor?.getReturnType().getProperty('props');
        if (pp)
            propsType = checker.getTypeOfSymbolAtLocation(pp, loc);
    }
    if (!propsType)
        return {};
    const result = sample(propsType, ctx, 0, '');
    return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}
function sample(t, c, depth, name) {
    const { checker } = c;
    const f = t.flags;
    if (depth > 4)
        return null;
    // React special cases (checked before union decomposition: ReactNode is a big union)
    const alias = t.aliasSymbol?.name ?? '';
    if (/^(ReactNode|ReactChild|ReactText|ReactFragment)$/.test(alias))
        return 'Sample content';
    const str = checker.typeToString(t);
    if (str === 'JSX.Element' || str.startsWith('ReactElement') || str === 'React.JSX.Element')
        return { $$el: true };
    if (f & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))
        return sampleString(name);
    if (f & ts.TypeFlags.Boolean)
        return true;
    if (f & ts.TypeFlags.BooleanLiteral)
        return str === 'true';
    if (f & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral))
        return t.value;
    if (f & ts.TypeFlags.String)
        return sampleString(name);
    if (f & ts.TypeFlags.Number)
        return sampleNumber(name);
    if (f & ts.TypeFlags.BigInt)
        return 1;
    if (f & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void))
        return null;
    if (f & ts.TypeFlags.Union) {
        const members = t.types.filter((m) => !(m.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
        if (!members.length)
            return null;
        if (members[0].flags & ts.TypeFlags.BooleanLiteral)
            return true; // boolean | undefined
        // Prefer a non-function member so unions like `string | (() => void)` get real data
        const pick = members.find((m) => !m.getCallSignatures().length) ?? members[0];
        return sample(pick, c, depth + 1, name);
    }
    if (t.getCallSignatures().length)
        return { $$fn: name || 'callback' };
    const symName = t.symbol?.name;
    if (symName === 'Date')
        return { $$date: new Date().toISOString() };
    if (symName === 'Array' || symName === 'ReadonlyArray') {
        const el = checker.getTypeArguments(t)[0];
        return el ? [sample(el, c, depth + 1, name), sample(el, c, depth + 1, name)] : [];
    }
    if (t.target?.objectFlags & ts.ObjectFlags.Tuple) {
        return checker.getTypeArguments(t).map((a) => sample(a, c, depth + 1, name));
    }
    if (symName === 'Map' || symName === 'Set' || symName === 'Promise')
        return null;
    if (f & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
        const out = {};
        for (const p of checker.getPropertiesOfType(t)) {
            if (p.name === 'key' || p.name === 'ref')
                continue;
            const optional = !!(p.flags & ts.SymbolFlags.Optional);
            if (optional) {
                if (!c.fillOptional)
                    continue;
                const fromLib = p.declarations?.every((d) => d.getSourceFile().fileName.includes('node_modules'));
                if (fromLib)
                    continue;
            }
            out[p.name] = sample(checker.getTypeOfSymbolAtLocation(p, c.loc), c, depth + 1, p.name);
        }
        const idx = t.getStringIndexType();
        if (idx && !Object.keys(out).length)
            out['example'] = sample(idx, c, depth + 1, name);
        return out;
    }
    return null;
}
function sampleString(n) {
    if (/email/i.test(n))
        return 'jane@example.com';
    if (/(img|image|avatar|src|photo|thumbnail|logo|icon)/i.test(n))
        return PLACEHOLDER_IMG;
    if (/(url|href|link)/i.test(n))
        return 'https://example.com';
    if (/name/i.test(n))
        return 'Jane Doe';
    if (/(title|label|heading)/i.test(n))
        return 'Sample title';
    if (/(description|text|body|message|content|subtitle)/i.test(n))
        return 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    if (/colou?r/i.test(n))
        return '#4f46e5';
    if (/(date|time)/i.test(n))
        return new Date().toISOString();
    if (/id$/i.test(n))
        return 'id-1';
    return n ? `Sample ${n}` : 'Sample text';
}
function sampleNumber(n) {
    if (/(percent|progress)/i.test(n))
        return 60;
    if (/(price|amount|cost)/i.test(n))
        return 29.99;
    return 42;
}
//# sourceMappingURL=props.js.map