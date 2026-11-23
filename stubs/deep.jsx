// A "deep dummy": stands in for data that doesn't exist (API results, store state, missing context).
//  - any property path resolves, and it can be called
//  - array methods run on 3 sample items, so `.slice(0, 4).map(...)` renders a few cards
//  - as a string it reads "Sample text", as a number 42
const ARRAY_METHODS = new Set(Object.getOwnPropertyNames(Array.prototype));
const sample = () => [deep(), deep(), deep()];
export function deep() {
  return new Proxy(function () {}, {
    get(_, k) {
      if (k === '__pv_deep') return true;
      if (k === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 42 : 'Sample text');
      if (k === Symbol.iterator) return function* () { yield* sample(); };
      if (typeof k === 'symbol') return undefined;
      if (k === 'then' || k === '$$typeof' || k === 'nodeType') return undefined;
      if (k === 'length') return 3;
      if (k === 'toString' || k === 'valueOf') return () => 'Sample text';
      if (ARRAY_METHODS.has(k) && k !== 'constructor') return (...a) => sample()[k](...a);
      return deep();
    },
    apply() { return deep(); },
  });
}
export const isDeep = (v) => typeof v === 'function' && v.__pv_deep === true;
