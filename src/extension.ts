import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findComponents } from './scanner';
import { generateProps } from './props';
import { bundle } from './bundler';
import { renderHtml } from './webview';

interface Target { fileName: string; exportName: string; label: string }

let panel: vscode.WebviewPanel | undefined;
let current: Target | undefined;
let renderToken = 0;

class PreviewLens implements vscode.CodeLensProvider {
  private emitter = new vscode.EventEmitter<void>();
  onDidChangeCodeLenses = this.emitter.event;
  refresh() { this.emitter.fire(); }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const found = findComponents(doc.fileName, doc.getText());
    const atTop = vscode.workspace.getConfiguration('componentPreviewer').get<string>('codeLensPosition', 'top') === 'top';
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

function findGlobalCss(root: string, setting?: string): string[] {
  if (setting) return [setting];
  const found = new Set<string>();
  const rel = (abs: string) => path.relative(root, abs);
  for (const c of ['src/app/globals.css', 'app/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'src/index.css', 'src/globals.css']) {
    if (fs.existsSync(path.join(root, c))) found.add(c);
  }
  for (const l of ['src/app/layout.tsx', 'app/layout.tsx', 'src/pages/_app.tsx', 'pages/_app.tsx', 'src/main.tsx', 'src/index.tsx']) {
    const file = path.join(root, l);
    if (!fs.existsSync(file)) continue;
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/^\s*import\s+['"]([^'"]+\.css)['"]/gm)) {
      const spec = m[1];
      const abs = spec.startsWith('.') ? path.resolve(path.dirname(file), spec)
        : spec.startsWith('@/') ? path.join(root, fs.existsSync(path.join(root, 'src')) ? 'src' : '', spec.slice(2))
        : '';
      if (abs && fs.existsSync(abs)) found.add(rel(abs));
    }
  }
  return [...found];
}

async function render() {
  if (!panel || !current) return;
  const t = current;
  const token = ++renderToken;
  const uri = vscode.Uri.file(t.fileName);
  const root = (vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0])?.uri.fsPath;
  panel.title = `Preview: ${t.label}`;
  if (!root) {
    panel.webview.html = renderHtml({ label: t.label, error: 'Open the file inside a workspace folder.' });
    return;
  }
  const cfg = vscode.workspace.getConfiguration('componentPreviewer');
  try {
    let props = generateProps(t.fileName, t.exportName, cfg.get<boolean>('fillOptionalProps', false));

    // Your own overrides: .vscode/component-preview.props.json -> { "AppFooter": { "title": "Hi" } }
    const overridePath = path.join(root, '.vscode', 'component-preview.props.json');
    if (fs.existsSync(overridePath)) {
      const all = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
      const o = all[t.label] ?? all[t.exportName];
      if (o && typeof o === 'object') props = { ...props, ...o };
    }

    // Global stylesheets: the setting, else globals.css plus any CSS imported by the app's layout/_app
    const globalCss = findGlobalCss(root, cfg.get<string>('globalCss'));

    const { js, css, notes } = await bundle({ fileName: t.fileName, exportName: t.exportName, props, root, globalCss });
    if (token !== renderToken) return; // a newer render superseded this one
    panel.webview.html = renderHtml({ label: t.label, js, css, props, notes });
  } catch (e: any) {
    if (token !== renderToken) return;
    panel.webview.html = renderHtml({ label: t.label, error: String(e?.message ?? e) });
  }
}

async function previewCommand(fileName?: string, exportName?: string, label?: string) {
  if (!fileName) {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const found = findComponents(ed.document.fileName, ed.document.getText());
    if (!found.length) return vscode.window.showInformationMessage('No components found in this file.');
    const pick =
      found.length === 1
        ? found[0]
        : await vscode.window
            .showQuickPick(found.map((f) => ({ label: f.name, f })), { placeHolder: 'Which component?' })
            .then((p) => p?.f);
    if (!pick) return;
    fileName = ed.document.fileName; exportName = pick.exportName; label = pick.name;
  }
  current = { fileName, exportName: exportName!, label: label ?? exportName! };

  if (!panel) {
    panel = vscode.window.createWebviewPanel('componentPreview', 'Preview', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    });
    panel.onDidDispose(() => { panel = undefined; current = undefined; });
  } else {
    panel.reveal(vscode.ViewColumn.Beside, true);
  }
  panel.webview.html = renderHtml({ label: current.label, building: true });
  await render();
}

export function activate(ctx: vscode.ExtensionContext) {
  const lens = new PreviewLens();
  ctx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ language: 'typescriptreact' }, { language: 'javascriptreact' }],
      lens
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('componentPreviewer.codeLensPosition')) lens.refresh();
    }),
    vscode.commands.registerCommand('componentPreviewer.preview', previewCommand)
  );

  // Re-render on any save in the workspace (the component or anything it imports)
  let timer: NodeJS.Timeout | undefined;
  ctx.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (!panel) return;
      clearTimeout(timer);
      timer = setTimeout(render, 250);
    })
  );
}

export function deactivate() {}
