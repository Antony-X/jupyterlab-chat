import * as React from 'react';
import { MessageSquare } from 'lucide-react';
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
      title="Chat with LLM (Ctrl+Shift+L)"
      className={cn(
        'fixed bottom-5 right-5 z-[9998] h-12 w-12 rounded-full',
        'bg-header-bg text-header-fg',
        'shadow-fab transition-all duration-200 ease-out',
        'flex items-center justify-center',
        'hover:bg-brand hover:scale-110',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2',
        open && 'scale-95 bg-brand',
        hasNotification && !open && 'animate-jc-pulse'
      )}
    >
      <MessageSquare size={20} strokeWidth={2} />
    </button>
  );
}
