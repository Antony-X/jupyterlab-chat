import * as React from 'react';
import { useDragResize } from '../../hooks/useDragResize';
import { cn } from '../../lib/utils';

interface Props {
  open: boolean;
  children: (api: {
    onHeaderMouseDown: (e: React.MouseEvent) => void;
  }) => React.ReactNode;
}

export function ChatPanel({ open, children }: Props) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const { geom, onHeaderMouseDown, onResizeMouseDown } = useDragResize(panelRef);
  const [mounted, setMounted] = React.useState(false);
  const [closing, setClosing] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, 260);
    return () => clearTimeout(t);
  }, [open, mounted]);

  if (!mounted) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed z-[9999] flex flex-col overflow-hidden',
        'rounded-lg border border-line bg-paper shadow-panel',
        'origin-bottom-right',
        closing ? 'animate-pop-out' : 'animate-pop-in'
      )}
      style={{
        left: geom.left,
        top: geom.top,
        width: geom.width,
        height: geom.height,
      }}
    >
      {children({ onHeaderMouseDown })}
      <div
        className="jc-resize-handle absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
        onMouseDown={onResizeMouseDown}
        title="Resize"
      />
    </div>
  );
}
