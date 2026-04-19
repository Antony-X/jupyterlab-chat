import * as React from 'react';
import { X, Trash2, MessagesSquare } from 'lucide-react';
import type { SessionSummary } from '../../lib/api';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

interface Props {
  sessions: SessionSummary[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function SessionsList({
  sessions,
  currentId,
  onSelect,
  onDelete,
  onClose,
}: Props) {
  return (
    <div className="absolute inset-x-0 top-[46px] bottom-0 z-10 bg-paper border-t border-line flex flex-col animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line bg-paper-2/60">
        <div className="flex items-center gap-1.5 text-ink-soft font-serif text-sm font-semibold">
          <MessagesSquare size={14} />
          Past Chats
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} title="Close">
          <X size={13} />
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto jc-scroll">
        {sessions.length === 0 ? (
          <div className="text-center text-muted text-xs-plus p-8 font-sans">
            No past chats yet.
            <br />
            Start typing to begin.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {sessions.map((s) => {
              const isActive = s.id === currentId;
              return (
                <li
                  key={s.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2.5 cursor-pointer',
                    'hover:bg-brand-soft/60 transition-colors',
                    isActive && 'bg-brand-soft'
                  )}
                  onClick={() => onSelect(s.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'truncate text-sm-plus font-medium font-sans',
                        isActive ? 'text-brand-ink' : 'text-ink'
                      )}
                    >
                      {s.title || s.id}
                    </div>
                    <div className="text-[10.5px] text-muted mt-0.5 font-sans">
                      {(s.date || '').slice(0, 10)} · {s.count} msgs
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      'opacity-0 group-hover:opacity-100 transition-opacity',
                      'text-muted hover:text-danger p-1 rounded'
                    )}
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm('Delete this chat?')) return;
                      onDelete(s.id);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
