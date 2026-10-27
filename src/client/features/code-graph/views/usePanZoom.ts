import { useEffect, useRef, useState } from 'react';

interface Box { x: number; y: number; w: number; h: number }

/** Wheel zoom around the cursor and drag to pan an SVG; the viewBox resets when `bounds` change. */
export function usePanZoom(bounds: { w: number; h: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box>({ x: 0, y: 0, w: bounds.w, h: bounds.h });
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => setVb({ x: 0, y: 0, w: bounds.w, h: bounds.h }), [bounds.w, bounds.h]);

  /** Pixels per viewBox unit under `xMidYMid meet`, and the letterbox offset. */
  const metrics = (v: Box, r: DOMRect) => {
    const s = Math.min(r.width / v.w, r.height / v.h);
    return { s, offX: (r.width - v.w * s) / 2, offY: (r.height - v.h * s) / 2 };
  };

  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const f = Math.exp(e.deltaY * 0.0015);
      setVb((v) => {
        const { s, offX, offY } = metrics(v, r);
        const cx = v.x + (e.clientX - r.left - offX) / s;
        const cy = v.y + (e.clientY - r.top - offY) / s;
        return { x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f, w: v.w * f, h: v.h * f };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if ((e.target as Element).closest('[data-node]')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      if (!drag.current) return;
      const r = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      drag.current = { x: e.clientX, y: e.clientY };
      setVb((v) => {
        const { s } = metrics(v, r);
        return { ...v, x: v.x - dx / s, y: v.y - dy / s };
      });
    },
    onPointerUp: () => { drag.current = null; },
    onDoubleClick: () => setVb({ x: 0, y: 0, w: bounds.w, h: bounds.h }),
  };
  return { ref, viewBox: `${vb.x} ${vb.y} ${vb.w} ${vb.h}`, handlers };
}
