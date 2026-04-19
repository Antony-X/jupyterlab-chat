import * as React from 'react';
import { cn } from '../../lib/utils';

export type NativeSelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-7 rounded border border-white/15 bg-white/5 text-header-fg px-2 pr-6 text-xs-plus',
        'font-sans cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
        'transition-colors hover:bg-white/10 max-w-[180px] truncate',
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
);
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
