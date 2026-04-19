import * as React from 'react';
import { Save, FolderOpen, Download, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  onSave: () => void;
  onLoad: () => void;
  onExport: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function ChatMenu({ onSave, onLoad, onExport, onClear, onClose }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const h = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(h);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    danger?: boolean
  ) => (
    <button
      type="button"
      className={cn(
        'w-full flex items-center gap-2 px-3 py-2 text-left text-xs-plus font-sans',
        'transition-colors',
        danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-brand-soft'
      )}
      onClick={() => {
        onClose();
        onClick();
      }}
    >
      <span className={cn('inline-flex', danger ? 'text-danger' : 'text-muted')}>
        {icon}
      </span>
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      className={cn(
        'absolute right-2 top-[46px] z-20 min-w-[170px]',
        'rounded-lg border border-line bg-paper shadow-panel overflow-hidden',
        'animate-fade-in'
      )}
    >
      {item(<Save size={13} />, 'Save chat', onSave)}
      {item(<FolderOpen size={13} />, 'Load chat', onLoad)}
      {item(<Download size={13} />, 'Export .md', onExport)}
      <div className="h-px bg-line my-0.5" />
      {item(<Trash2 size={13} />, 'Clear history', onClear, true)}
    </div>
  );
}
