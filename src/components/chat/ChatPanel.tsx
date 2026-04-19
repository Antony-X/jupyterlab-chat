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
  const [animOpen, setAnimOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => setAnimOpen(true));
      return () => cancelAnimationFrame(r);
    }
    setAnimOpen(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      ref={panelRef}
      className={cn(
        'fixed z-[9999] flex flex-col overflow-hidden',
        'rounded-lg border border-line bg-paper shadow-panel',
        'origin-bottom-right transition-[transform,opacity,filter] duration-[240ms] ease-out',
        open && animOpen
          ? 'opacity-100 scale-100 blur-0'
          : 'opacity-0 scale-[.05] blur-sm pointer-events-none'
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
