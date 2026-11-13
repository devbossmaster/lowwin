import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/modules/ui/utils';
const buttonVariants = cva('inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold leading-normal transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:pointer-events-none', { variants: { variant: { default: 'bg-[var(--action-primary)] text-[var(--action-ink)] hover:bg-[var(--action-hover)] active:bg-[var(--action-pressed)] disabled:bg-[var(--action-disabled)] disabled:text-[var(--action-disabled-ink)]', outline: 'border border-border bg-transparent text-foreground hover:bg-mint disabled:opacity-50' } }, defaultVariants: { variant: 'default' } });
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, className }))} {...props} />;
}
