import * as React from 'react';
import { cn } from '../../lib/utils';
import type { DisplayKind } from '../../hooks/useChat';

interface Props {
  kind: Exclude<DisplayKind, 'user' | 'assistant'>;
  text: string;
}

export function StatusMessage({ kind, text }: Props) {
  return (
    <div
      className={cn(
        'my-1.5 self-center text-center text-[11.5px] tracking-wider uppercase font-sans font-medium',
        'px-3 py-1 rounded',
        kind === 'status' && 'text-ink-soft bg-paper-2/60 border border-line/50',
        kind === 'error' && 'text-white bg-danger/90',
        kind === 'stopped' && 'text-ink-soft bg-paper-2/60 italic normal-case tracking-normal'
      )}
    >
      {text}
    </div>
  );
}
