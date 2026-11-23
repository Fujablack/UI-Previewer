const router = { push: async () => true, replace: async () => true, back() {}, reload() {}, prefetch: async () => {},
  pathname: '/', route: '/', asPath: '/', query: {}, isReady: true, events: { on() {}, off() {}, emit() {} } };
export const useRouter = () => router;
export const withRouter = (C) => (p) => <C router={router} {...p} />;
export default router;
