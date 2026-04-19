import * as React from 'react';
import { cn } from '../../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          'flex w-full rounded bg-input-bg border border-line px-3 py-2 text-sm-plus text-ink placeholder:text-muted',
          'resize-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:border-brand',
          'font-sans leading-relaxed transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
