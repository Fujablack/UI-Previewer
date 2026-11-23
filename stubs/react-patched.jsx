// What project source files get when they `import ... from 'react'`:
// the real React, except contexts created here are tagged so a missing Provider is harmless.
import * as R from 'react';
export * from 'react';
const Real = R.default || R;
export function createContext(d) {
  const c = Real.createContext(d);
  try { c.__pv = true; } catch (e) {}
  return c;
}
export default { ...Real, createContext };
