import React from 'react';
export default function dynamic(loader) {
  const L = React.lazy(() => Promise.resolve(typeof loader === 'function' ? loader() : loader).then((m) => ({ default: m && m.default ? m.default : m })));
  return (props) => <React.Suspense fallback={null}><L {...props} /></React.Suspense>;
}
