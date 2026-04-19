import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50 select-none',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-white shadow-sm hover:bg-brand-ink active:scale-[.98]',
        soft:
          'bg-brand-soft text-brand-ink hover:bg-brand/20 active:scale-[.98]',
        outline:
          'border border-line bg-paper text-ink hover:bg-paper-2 active:scale-[.98]',
        ghost:
          'text-ink-soft hover:bg-paper-2 hover:text-ink active:scale-[.98]',
        'header-icon':
          'text-header-fg/80 hover:text-header-fg hover:bg-white/10 rounded active:scale-[.96]',
        destructive:
          'bg-danger text-white hover:bg-danger/90 active:scale-[.98]',
        stop:
          'bg-danger text-white hover:bg-danger/90 active:scale-[.98]',
      },
      size: {
        default: 'h-8 px-3 text-xs-plus',
        sm: 'h-7 px-2.5 text-xs',
        xs: 'h-6 px-2 text-[11px]',
        icon: 'h-7 w-7 p-0',
        'icon-sm': 'h-6 w-6 p-0 text-[13px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: any = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
