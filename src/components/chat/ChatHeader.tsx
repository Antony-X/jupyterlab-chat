import * as React from 'react';
import { Plus, History, Moon, Sun, MoreVertical, X } from 'lucide-react';
import { NativeSelect } from '../ui/select';
import { Button } from '../ui/button';
import { MODELS } from '../../constants';
import { cn } from '../../lib/utils';

interface Props {
  theme: 'light' | 'dark';
  selectedModel: string;
  onModelChange: (id: string) => void;
  onToggleTheme: () => void;
  onNew: () => void;
  onToggleSessions: () => void;
  onToggleMenu: () => void;
  onClose: () => void;
  onHeaderMouseDown: (e: React.MouseEvent) => void;
}

export function ChatHeader({
  theme,
  selectedModel,
  onModelChange,
  onToggleTheme,
  onNew,
  onToggleSessions,
  onToggleMenu,
  onClose,
  onHeaderMouseDown,
}: Props) {
  return (
    <div
      className={cn(
        'jc-header-accent relative flex items-center gap-1.5 px-2.5 py-1.5',
        'bg-header-bg text-header-fg cursor-move select-none'
      )}
      onMouseDown={onHeaderMouseDown}
    >
      <NativeSelect
        value={selectedModel}
        onChange={(e) => onModelChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        title="Model"
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </NativeSelect>
      <div className="font-serif font-semibold tracking-tight text-sm ml-1 flex-1 truncate">
        Chat
      </div>
      <Button variant="header-icon" size="icon" onClick={onNew} title="New chat">
        <Plus size={14} />
      </Button>
      <Button
        variant="header-icon"
        size="icon"
        onClick={onToggleSessions}
        title="Past chats"
      >
        <History size={14} />
      </Button>
      <Button
        variant="header-icon"
        size="icon"
        onClick={onToggleTheme}
        title="Toggle theme"
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </Button>
      <Button
        variant="header-icon"
        size="icon"
        onClick={onToggleMenu}
        title="Menu"
      >
        <MoreVertical size={14} />
      </Button>
      <Button variant="header-icon" size="icon" onClick={onClose} title="Close">
        <X size={14} />
      </Button>
    </div>
  );
}
