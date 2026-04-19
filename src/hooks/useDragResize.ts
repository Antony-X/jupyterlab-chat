import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

const INIT_W = 480;
const INIT_H = 560;
const MIN_W = 320;
const MIN_H = 300;

function defaultGeometry(): Geometry {
  return {
    left: Math.max(20, window.innerWidth - INIT_W - 20),
    top: Math.max(20, window.innerHeight - INIT_H - 80),
    width: INIT_W,
    height: INIT_H,
  };
}

export function useDragResize(panelRef: RefObject<HTMLElement>) {
  const [geom, setGeom] = useState<Geometry>(defaultGeometry);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag.current) {
        setGeom(g => ({ ...g, left: e.clientX - drag.current!.dx, top: e.clientY - drag.current!.dy }));
      }
      if (resize.current) {
        const { x, y, w, h } = resize.current;
        setGeom(g => ({
          ...g,
          width: Math.max(MIN_W, w + e.clientX - x),
          height: Math.max(MIN_H, h + e.clientY - y),
        }));
      }
    };
    const onUp = () => {
      drag.current = null;
      resize.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT') return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  }, [panelRef]);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    const panel = panelRef.current;
    if (!panel) return;
    resize.current = {
      x: e.clientX,
      y: e.clientY,
      w: panel.offsetWidth,
      h: panel.offsetHeight,
    };
    e.preventDefault();
    e.stopPropagation();
  }, [panelRef]);

  return { geom, onHeaderMouseDown, onResizeMouseDown };
}
