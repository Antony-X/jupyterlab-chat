import { RefObject, useCallback, useEffect, useRef, useState } from 'react';

export interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

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

interface ResizeState {
  edge: ResizeEdge;
  startX: number;
  startY: number;
  startGeom: Geometry;
}

export function useDragResize(panelRef: RefObject<HTMLElement>) {
  const [geom, setGeom] = useState<Geometry>(defaultGeometry);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const resize = useRef<ResizeState | null>(null);

  useEffect(() => {
    // Keep at least this much of the header visible no matter how far the
    // user drags. Without a clamp the panel can end up fully off-screen with
    // no way to retrieve it — position is state-persisted across reopens.
    const EDGE_MARGIN = 40;
    const clampLeft = (l: number, w: number) =>
      Math.max(
        EDGE_MARGIN - w,
        Math.min(window.innerWidth - EDGE_MARGIN, l)
      );
    const clampTop = (t: number) =>
      Math.max(0, Math.min(window.innerHeight - EDGE_MARGIN, t));

    const onMove = (e: MouseEvent) => {
      if (drag.current) {
        setGeom(g => ({
          ...g,
          left: clampLeft(e.clientX - drag.current!.dx, g.width),
          top: clampTop(e.clientY - drag.current!.dy),
        }));
      }
      if (resize.current) {
        const { edge, startX, startY, startGeom } = resize.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        setGeom(() => {
          let { left, top, width, height } = startGeom;
          if (edge.includes('e')) {
            width = Math.max(MIN_W, startGeom.width + dx);
          }
          if (edge.includes('s')) {
            height = Math.max(MIN_H, startGeom.height + dy);
          }
          // W/N edges adjust left/top so the opposite edge stays anchored.
          // Use the clamped width/height in the shift so the panel doesn't
          // jump right/down once we bottom out at MIN_W/MIN_H.
          if (edge.includes('w')) {
            const newW = Math.max(MIN_W, startGeom.width - dx);
            left = startGeom.left + (startGeom.width - newW);
            width = newW;
          }
          if (edge.includes('n')) {
            const newH = Math.max(MIN_H, startGeom.height - dy);
            top = startGeom.top + (startGeom.height - newH);
            height = newH;
          }
          return { left, top, width, height };
        });
      }
    };
    const onUp = () => {
      drag.current = null;
      resize.current = null;
      document.body.style.userSelect = '';
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

  const onResizeMouseDown = useCallback(
    (edge: ResizeEdge) => (e: React.MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      resize.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startGeom: {
          left: panel.offsetLeft,
          top: panel.offsetTop,
          width: panel.offsetWidth,
          height: panel.offsetHeight,
        },
      };
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    },
    [panelRef]
  );

  return { geom, onHeaderMouseDown, onResizeMouseDown };
}
