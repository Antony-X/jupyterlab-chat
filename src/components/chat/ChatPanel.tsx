import * as React from 'react';
import { useDragResize, ResizeEdge } from '../../hooks/useDragResize';
import { cn } from '../../lib/utils';

interface Props {
  open: boolean;
  children: (api: {
    onHeaderMouseDown: (e: React.MouseEvent) => void;
  }) => React.ReactNode;
}

// Edge handles: thin strips along each side. Corner handles: small squares
// that overlap the edge strips and take precedence (stacked later in DOM).
const EDGE_HANDLES: Array<{ edge: ResizeEdge; className: string }> = [
  { edge: 'n', className: 'top-0 left-0 right-0 h-1.5 cursor-ns-resize' },
  { edge: 's', className: 'bottom-0 left-0 right-0 h-1.5 cursor-ns-resize' },
  { edge: 'w', className: 'top-0 bottom-0 left-0 w-1.5 cursor-ew-resize' },
  { edge: 'e', className: 'top-0 bottom-0 right-0 w-1.5 cursor-ew-resize' },
];

const CORNER_HANDLES: Array<{ edge: ResizeEdge; className: string; grip?: boolean }> = [
  { edge: 'nw', className: 'top-0 left-0 w-3 h-3 cursor-nwse-resize' },
  { edge: 'ne', className: 'top-0 right-0 w-3 h-3 cursor-nesw-resize' },
  { edge: 'sw', className: 'bottom-0 left-0 w-3 h-3 cursor-nesw-resize' },
  { edge: 'se', className: 'bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize', grip: true },
];

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
      {EDGE_HANDLES.map(h => (
        <div
          key={h.edge}
          className={cn('absolute z-20', h.className)}
          onMouseDown={onResizeMouseDown(h.edge)}
        />
      ))}
      {CORNER_HANDLES.map(h => (
        <div
          key={h.edge}
          className={cn(
            'absolute z-30',
            h.className,
            h.grip && 'jc-resize-handle'
          )}
          onMouseDown={onResizeMouseDown(h.edge)}
          title={h.grip ? 'Resize' : undefined}
        />
      ))}
    </div>
  );
}
