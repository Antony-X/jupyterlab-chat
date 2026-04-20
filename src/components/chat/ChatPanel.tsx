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
    } else if (mounted) {
      setClosing(true);
    }
  }, [open, mounted]);

  // Unmount when the pop-out keyframe animation finishes — the CSS duration
  // is the single source of truth, no JS timer to drift out of sync with it.
  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'pop-out') {
      setMounted(false);
      setClosing(false);
    }
  };

  if (!mounted) return null;

  return (
    <div
      ref={panelRef}
      onAnimationEnd={handleAnimationEnd}
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
