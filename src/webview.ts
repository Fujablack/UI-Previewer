import * as crypto from 'crypto';

export interface ViewState {
  label: string;
  js?: string;
  css?: string;
  props?: unknown;
  error?: string;
  building?: boolean;
  notes?: string[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderHtml(s: ViewState): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  const stage = s.error
    ? `<pre class="pv-error">${esc(s.error)}</pre>`
    : s.building
    ? `<div class="pv-muted">Building…</div>`
    : `<div id="root"></div>`;
  const bundle = s.js
    ? `<script nonce="${nonce}">${s.js.replace(/<\/script/gi, '<\\/script')}</script>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http:; font-src data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${s.css ?? ''}</style>
<style>
  #pv-bar { position: sticky; top: 0; z-index: 99999; display: flex; gap: 8px; align-items: center; padding: 6px 10px;
    font: 12px var(--vscode-font-family, sans-serif); background: var(--vscode-editor-background, #1e1e1e);
    color: var(--vscode-editor-foreground, #ccc); border-bottom: 1px solid var(--vscode-panel-border, #444); }
  #pv-bar button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--vscode-panel-border, #555); border-radius: 3px; padding: 1px 8px; cursor: pointer; }
  #pv-bar details { margin-left: auto; max-width: 60%; }
  #pv-bar pre { max-height: 240px; overflow: auto; margin: 4px 0 0; }
  #pv-stage { padding: 24px; min-height: calc(100vh - 80px); background: #fff; }
  .pv-error { color: #c00; white-space: pre-wrap; font: 12px monospace; }
  .pv-note { padding: 4px 10px; font: 11px sans-serif; background: #fff4d6; color: #5c4400; }
  .pv-muted { color: #888; font: 13px sans-serif; }
</style></head>
<body style="margin:0">
  <div id="pv-bar">
    <strong>${esc(s.label)}</strong>
    <button data-bg="#ffffff">Light</button>
    <button data-bg="#1e1e1e">Dark</button>
    <button data-bg="repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 50% / 16px 16px">Checker</button>
    <details id="pv-errs" hidden><summary>⚠ <span id="pv-n">0</span> runtime errors (ignored)</summary><pre id="pv-log"></pre></details>
    <details><summary>Props</summary><pre>${esc(JSON.stringify(s.props ?? {}, null, 2))}</pre></details>
  </div>
  ${s.notes?.length ? `<div class="pv-note">⚠ ${s.notes.map(esc).join(' · ')}</div>` : ''}
  <div id="pv-stage">${stage}</div>
  <script nonce="${nonce}">
    document.querySelectorAll('[data-bg]').forEach(function (b) {
      b.onclick = function () { document.getElementById('pv-stage').style.background = b.dataset.bg; };
    });
    var n = 0;
    function note(msg) {
      n++; document.getElementById('pv-errs').hidden = false;
      document.getElementById('pv-n').textContent = n;
      document.getElementById('pv-log').textContent += msg + '\n\n';
    }
    window.addEventListener('error', function (e) { note(e.message); });
    window.addEventListener('unhandledrejection', function (e) { note('Promise: ' + (e.reason && e.reason.message || e.reason)); });
  </script>
  ${bundle}
</body></html>`;
}
