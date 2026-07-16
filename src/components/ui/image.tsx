import * as React from 'react';
import { cn } from '@/lib/utils';
import { resolveAssetUrl } from '@/lib/assets';

type NativeImgProps = React.ComponentPropsWithoutRef<'img'>;

export type ImageProps = NativeImgProps

export const Image = React.forwardRef<HTMLImageElement, ImageProps>(
  (
    {
      src,
      width,
      height,
      className,
      loading = 'lazy',
      decoding = 'async',
      ...rest
    },
    ref,
  ) => {
    return (
      <img
        {...rest}
        ref={ref}
        src={typeof src === 'string' ? resolveAssetUrl(src) : src}
        width={width}
        height={height}
        className={cn(
          'bg-linear-to-b from-gray-50/20 to-gray-200/20',
          className,
        )}
        loading={loading}
        decoding={decoding}
      />
    );
  },
);

Image.displayName = 'Image';

export default Image;
