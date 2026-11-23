import React from 'react';
const Link = React.forwardRef(function Link(props, ref) {
  const { href, children, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, as, onClick, ...rest } = props;
  const url = href && typeof href === 'object' ? (href.pathname || '#') : href;
  return <a ref={ref} href={url} {...rest} onClick={(e) => { e.preventDefault(); onClick && onClick(e); }}>{children}</a>;
});
export default Link;
