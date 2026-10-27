import { useEffect, useMemo, useRef, useState } from 'react';
import type { CodeGraphFileDTO } from '../../../lib/types';
import { hashString } from '../explorer-model';
import { STATE_COLORS } from '../graph-model';
import { Placeholder } from '../workbench/Workbench';
import { HEADER, layoutTreemap } from './treemap-model';
import styles from './Views.module.css';

/** Where the weight lives: folders nested, files sized by how many symbols they hold. */
export function TreemapView({ files, changed, activeFile, onOpenFile }: {
  files: CodeGraphFileDTO[] | undefined;
  changed: ReadonlySet<string>;
  activeFile: string | null;
  onOpenFile: (file: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<string | undefined>();
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cells = useMemo(
    () => (files && size.w > 0 ? layoutTreemap(files, changed, { x: 0, y: 0, w: size.w, h: size.h }, zoom) : []),
    [files, changed, size, zoom],
  );
  const up = zoom ? (zoom.includes('/') ? zoom.slice(0, zoom.lastIndexOf('/')) : undefined) : undefined;
  const hue = (path: string) => hashString(path.split('/').slice(0, 2).join('/')) % 360;

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }}>
      {files && files.length === 0 && <Placeholder icon="files" title="No indexed files">Run <code>ctk index build</code>.</Placeholder>}
      <svg width={size.w} height={size.h} className={styles.svg} style={{ cursor: 'default' }} role="img" aria-label="Treemap of the codebase">
        {cells.map((c) => {
          const label = c.kind === 'dir' ? c.name : c.name;
          const room = c.w > 44 && c.h > (c.kind === 'dir' ? HEADER : 16);
          return (
            <g
              key={`${c.kind}:${c.path}`}
              className={styles.hit}
              onClick={() => (c.kind === 'dir' ? setZoom(c.path) : onOpenFile(c.path))}
            >
              <rect
                x={c.x + 0.5}
                y={c.y + 0.5}
                width={Math.max(0, c.w - 1)}
                height={Math.max(0, c.h - 1)}
                fill={c.kind === 'dir' ? `hsl(${hue(c.path)} 25% ${12 + c.depth * 3}%)` : `hsl(${hue(c.path)} 40% ${c.changed ? 38 : 26}%)`}
                stroke={c.path === activeFile ? STATE_COLORS.selected : c.changed ? STATE_COLORS.touched : 'var(--vscode-editor-background)'}
                strokeWidth={c.path === activeFile || c.changed ? 1.5 : 1}
              />
              {room && <text className={styles.label} x={c.x + 5} y={c.y + 12}>{label.slice(0, Math.floor(c.w / 6.5))}</text>}
              <title>{`${c.path} · ${c.value} symbols${c.changed ? ' · changed' : ''}`}</title>
            </g>
          );
        })}
      </svg>
      {zoom !== undefined && (
        <div className={styles.toolbar}>
          <button type="button" className={styles.crumbBtn} onClick={() => setZoom(up)}>↑ up</button>
          <span>{zoom}</span>
        </div>
      )}
      <div className={styles.hint}>area = symbols · orange outline = changed · click a folder to zoom, a file to open</div>
    </div>
  );
}
