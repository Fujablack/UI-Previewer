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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const scanner_1 = require("./scanner");
const props_1 = require("./props");
const bundler_1 = require("./bundler");
const webview_1 = require("./webview");
let panel;
let current;
let renderToken = 0;
class PreviewLens {
    emitter = new vscode.EventEmitter();
    onDidChangeCodeLenses = this.emitter.event;
    refresh() { this.emitter.fire(); }
    provideCodeLenses(doc) {
        const found = (0, scanner_1.findComponents)(doc.fileName, doc.getText());
        const atTop = vscode.workspace.getConfiguration('componentPreviewer').get('codeLensPosition', 'top') === 'top';
        return found.map((c) => {
            const line = atTop ? 0 : c.line; // 'top': everything on the first line of the file
            const title = atTop && found.length > 1 ? `▶ Preview ${c.name}` : '▶ Preview';
            return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                title,
                command: 'componentPreviewer.preview',
                arguments: [doc.fileName, c.exportName, c.name],
            });
        });
    }
}
function findGlobalCss(root, setting) {
    if (setting)
        return [setting];
    const found = new Set();
    const rel = (abs) => path.relative(root, abs);
    for (const c of ['src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'src/index.css', 'src/globals.css']) {
        if (fs.existsSync(path.join(root, c)))
            found.add(c);
    }
    for (const l of ['src/app/layout.tsx', 'app/layout.tsx', 'src/pages/_app.tsx', 'pages/_app.tsx', 'src/main.tsx', 'src/index.tsx']) {
        const file = path.join(root, l);
        if (!fs.existsSync(file))
            continue;
        for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\s*import\s+['"]([^'"]+\.css)['"]/gm)) {
            const spec = m[1];
            const abs = spec.startsWith('.') ? path.resolve(path.dirname(file), spec)
                : spec.startsWith('@/') ? path.join(root, fs.existsSync(path.join(root, 'src')) ? 'src' : '', spec.slice(2))
                    : '';
            if (abs && fs.existsSync(abs))
                found.add(rel(abs));
        }
    }
    return [...found];
}
async function render() {
    if (!panel || !current)
        return;
    const t = current;
    const token = ++renderToken;
    const uri = vscode.Uri.file(t.fileName);
    const root = (vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath;
    panel.title = `Preview: ${t.label}`;
    if (!root) {
        panel.webview.html = (0, webview_1.renderHtml)({ label: t.label, error: 'Open the file inside a workspace folder.' });
        return;
    }
    const cfg = vscode.workspace.getConfiguration('componentPreviewer');
    try {
        let props = (0, props_1.generateProps)(t.fileName, t.exportName, cfg.get('fillOptionalProps', false));
        // Your own overrides: .vscode/component-preview.props.json -> { "AppFooter": { "title": "Hi" } }
        const overridePath = path.join(root, '.vscode', 'component-preview.props.json');
        if (fs.existsSync(overridePath)) {
            const all = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
            const o = all[t.label] ?? all[t.exportName];
            if (o && typeof o === 'object')
                props = { ...props, ...o };
        }
        // Global stylesheets: the setting, else globals.css plus any CSS imported by the app's layout/_app
        const globalCss = findGlobalCss(root, cfg.get('globalCss'));
        const { js, css, notes } = await (0, bundler_1.bundle)({ fileName: t.fileName, exportName: t.exportName, props, root, globalCss });
        if (token !== renderToken)
            return; // a newer render superseded this one
        panel.webview.html = (0, webview_1.renderHtml)({ label: t.label, js, css, props, notes });
    }
    catch (e) {
        if (token !== renderToken)
            return;
        panel.webview.html = (0, webview_1.renderHtml)({ label: t.label, error: String(e?.message ?? e) });
    }
}
async function previewCommand(fileName, exportName, label) {
    if (!fileName) {
        const ed = vscode.window.activeTextEditor;
        if (!ed)
            return;
        const found = (0, scanner_1.findComponents)(ed.document.fileName, ed.document.getText());
        if (!found.length)
            return vscode.window.showInformationMessage('No components found in this file.');
        const pick = found.length === 1
            ? found[0]
            : await vscode.window
                .showQuickPick(found.map((f) => ({ label: f.name, f })), { placeHolder: 'Which component?' })
                .then((p) => p?.f);
        if (!pick)
            return;
        fileName = ed.document.fileName;
        exportName = pick.exportName;
        label = pick.name;
    }
    current = { fileName, exportName: exportName, label: label ?? exportName };
    if (!panel) {
        panel = vscode.window.createWebviewPanel('componentPreview', 'Preview', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        panel.onDidDispose(() => { panel = undefined; current = undefined; });
    }
    else {
        panel.reveal(vscode.ViewColumn.Beside, true);
    }
    panel.webview.html = (0, webview_1.renderHtml)({ label: current.label, building: true });
    await render();
}
function activate(ctx) {
    const lens = new PreviewLens();
    ctx.subscriptions.push(vscode.languages.registerCodeLensProvider([{ language: 'typescriptreact' }, { language: 'javascriptreact' }], lens), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('componentPreviewer.codeLensPosition'))
            lens.refresh();
    }), vscode.commands.registerCommand('componentPreviewer.preview', previewCommand));
    // Re-render on any save in the workspace (the component or anything it imports)
    let timer;
    ctx.subscriptions.push(vscode.workspace.onDidSaveTextDocument(() => {
        if (!panel)
            return;
        clearTimeout(timer);
        timer = setTimeout(render, 250);
    }));
}
function deactivate() { }
//# sourceMappingURL=extension.js.map