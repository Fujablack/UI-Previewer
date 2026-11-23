import React from 'react';
const num = (v) => { const n = Number(v); return n > 0 ? n : undefined; };
const Image = React.forwardRef(function Image(props, ref) {
  const { src, alt = '', width, height, fill, priority, quality, placeholder, blurDataURL,
    loader, unoptimized, onLoadingComplete, sizes, style, ...rest } = props;
  const url = src && typeof src === 'object' ? (src.src || (src.default && src.default.src)) : src;
  const st = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%', ...style } : style;
  return <img ref={ref} src={url} alt={alt} width={num(width)} height={num(height)} style={st} {...rest} />;
});
export default Image;
export const getImageProps = (p) => ({ props: p });
