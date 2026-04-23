import * as React from 'react';
import { MessageSquare, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  open: boolean;
  hasNotification: boolean;
  onClick: () => void;
}

export function ChatFAB({ open, hasNotification, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={open ? 'Close chat' : 'Chat with LLM (Ctrl+Shift+L)'}
      aria-label={open ? 'Close chat' : 'Open chat'}
      className={cn(
        'fixed bottom-5 right-5 z-[9998] h-12 w-12 rounded-full',
        'bg-header-bg text-header-fg',
        'shadow-fab transition-[transform,background-color] duration-200 ease-out',
        'flex items-center justify-center',
        'hover:scale-105 hover:bg-ink-soft',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        hasNotification && !open && 'animate-jc-pulse'
      )}
    >
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          'transition-[transform,opacity] duration-200 ease-out',
          open ? 'opacity-0 scale-75 rotate-45' : 'opacity-100 scale-100 rotate-0'
        )}
        aria-hidden
      >
        <MessageSquare size={20} strokeWidth={2} />
      </span>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center',
          'transition-[transform,opacity] duration-200 ease-out',
          open ? 'opacity-100 scale-100 rotate-0' : 'opacity-0 scale-75 -rotate-45'
        )}
        aria-hidden
      >
        <X size={22} strokeWidth={2.2} />
      </span>
    </button>
  );
}
