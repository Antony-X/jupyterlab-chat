import * as React from 'react';
import type { DisplayMsg } from '../../hooks/useChat';
import { userText } from '../../lib/notebook';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';
import { StatusMessage } from './StatusMessage';
import { cn } from '../../lib/utils';

interface Props {
  messages: DisplayMsg[];
  empty?: boolean;
  onEdit?: (idx: number, newText: string) => void;
  onDelete?: (idx: number) => void;
}

export function MessagesList({ messages, empty, onEdit, onDelete }: Props) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const atBottomRef = React.useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    atBottomRef.current = nearBottom;
  };

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  if (empty) {
    return (
      <div
        ref={scrollRef}
        className={cn(
          'flex-1 min-h-0 overflow-y-auto jc-scroll jc-dotgrid',
          'flex items-center justify-center'
        )}
      >
        <div className="text-center text-muted text-xs-plus px-6">
          <div className="font-serif text-base text-ink-soft mb-1">Chat</div>
          <div>Ask a question, attach files, or type / for commands.</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 min-h-0 overflow-y-auto jc-scroll jc-dotgrid px-3 py-2 flex flex-col"
    >
      {messages.map((m) => {
        if (m.kind === 'user') {
          return (
            <UserMessage
              key={m.id}
              displayText={m.originalText ?? userText(m.content)}
              serverIdx={m.serverIdx}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        }
        if (m.kind === 'assistant') {
          return (
            <AssistantMessage
              key={m.id}
              text={typeof m.content === 'string' ? m.content : ''}
              pending={m.pending}
            />
          );
        }
        return (
          <StatusMessage
            key={m.id}
            kind={m.kind}
            text={typeof m.content === 'string' ? m.content : String(m.content)}
          />
        );
      })}
    </div>
  );
}
