import React from 'react';
import clsx from 'clsx';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shape?: 'rect' | 'circle' | 'text';
  width?: string | number;
  height?: string | number;
}

export const Skeleton: React.FC<SkeletonProps> = ({
  shape = 'rect',
  width,
  height,
  className,
  style,
  ...rest
}) => (
  <div
    className={clsx(
      'animate-pulse bg-[var(--bg-input)]',
      shape === 'circle' && 'rounded-full',
      shape === 'rect' && 'rounded-md',
      shape === 'text' && 'h-3 w-full rounded',
      className
    )}
    style={{ width, height, ...style }}
    {...rest}
  />
);

export default Skeleton;
