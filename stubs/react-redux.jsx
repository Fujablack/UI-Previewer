import React from 'react';
import { deep } from 'preview-deep';
const state = deep();
const store = { getState: () => state, dispatch: (a) => a, subscribe: () => () => {}, replaceReducer() {} };
export const Provider = ({ children }) => children;
export const useSelector = (sel) => { try { return sel(state); } catch (e) { return deep(); } };
export const useDispatch = () => store.dispatch;
export const useStore = () => store;
export const shallowEqual = () => true;
export const batch = (f) => f();
export const ReactReduxContext = React.createContext({ store });
export const connect = (mapState, mapDispatch) => (C) => (props) => {
  const sp = typeof mapState === 'function' ? mapState(state, props) : {};
  const dp = typeof mapDispatch === 'function' ? mapDispatch(store.dispatch, props) : mapDispatch || {};
  return <C {...props} {...sp} {...dp} />;
};
export default { Provider, connect };
