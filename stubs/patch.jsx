// Runs before any other module. Makes missing data / providers harmless so the UI still renders.
import { deep, isDeep } from 'preview-deep';
const R = require('react');
const J = require('react/jsx-runtime');

// 1) A context with no Provider yields a dummy instead of null
//    (always for contexts created by project source, for all contexts after a retry).
const origUseContext = R.useContext;
R.useContext = function useContext(ctx) {
  const v = origUseContext(ctx);
  return (v === undefined || v === null) && (ctx.__pv || window.__PV_ALL) ? deep() : v;
};

// 2) Network calls resolve with dummy data instead of failing.
window.fetch = () => Promise.resolve({
  ok: true, status: 200, statusText: 'OK', url: '', redirected: false, type: 'basic',
  headers: { get: () => null, has: () => false, forEach() {} },
  json: async () => deep(), text: async () => 'Sample text',
  blob: async () => new Blob([]), arrayBuffer: async () => new ArrayBuffer(0), formData: async () => ({}),
  clone() { return this; },
});

// 3) Dummy data that reaches the DOM is shown as readable placeholders instead of crashing/blank.
const TEXT = 'Sample text';
const IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#c7c7d1"/></svg>');
function fixProps(props) {
  if (!props) return props;
  let out = null;
  for (const k in props) {
    const v = props[k];
    if (isDeep(v)) {
      if (/^on[A-Z]/.test(k) || k === 'ref') continue; // handlers stay callable
      out = out || { ...props };
      out[k] = k === 'style' ? {} : k === 'dangerouslySetInnerHTML' ? { __html: '' }
        : /src|poster/i.test(k) ? IMG : k === 'href' ? '#' : TEXT;
    } else if (k === 'children' && Array.isArray(v) && v.some(isDeep)) {
      out = out || { ...props };
      out[k] = v.map((x) => (isDeep(x) ? TEXT : x));
    }
  }
  return out || props;
}
for (const name of ['jsx', 'jsxs']) {
  const f = J[name];
  if (typeof f === 'function') {
    J[name] = (type, props, key, ...rest) =>
      f(type, typeof type === 'string' ? fixProps(props) : props, isDeep(key) ? undefined : key, ...rest);
  }
}
const origCreate = R.createElement;
R.createElement = (type, props, ...children) =>
  origCreate(type, typeof type === 'string' ? fixProps(props) : props, ...children.map((c) => (isDeep(c) && typeof type === 'string' ? TEXT : c)));
