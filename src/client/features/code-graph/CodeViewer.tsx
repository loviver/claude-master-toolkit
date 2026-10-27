import { useEffect, useMemo, useRef } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import { FileCode } from 'lucide-react';
import { CopyableValue, EmptyState, Skeleton } from '../../components/ui';
import { useCodeGraphSource } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphOutlineDTO } from '../../lib/types';
import { CANVAS_BG } from './graph-model';
import { lineChanged } from './explorer-model';
import styles from './CodeGraph.module.css';

interface CodeViewerProps {
  project: string;
  file: string;
  revision: string | undefined;
  /** Lines to highlight and scroll to (a symbol's span); `nonce` re-scrolls to the same span. */
  target: { range: [number, number] | null; nonce: number };
  /** Lines the diff touches, marked in the gutter. */
  changedRanges: ReadonlyArray<readonly [number, number]>;
  onSymbol: (symbol: CodeGraphOutlineDTO) => void;
  errorMessage: (err: unknown) => string;
}

/** Code reads like the graph canvas: a fixed dark "screen" in both themes. */
const THEME = { ...themes.oneDark, plain: { ...themes.oneDark.plain, backgroundColor: CANVAS_BG } };

export function CodeViewer({ project, file, revision, target, changedRanges, onSymbol, errorMessage }: CodeViewerProps) {
  const source = useCodeGraphSource(project, file, revision);
  const scrollRef = useRef<HTMLDivElement>(null);
  const range = target.range;

  // Symbols by first line, so the gutter can mark where each one starts.
  const startsAt = useMemo(() => {
    const m = new Map<number, CodeGraphOutlineDTO>();
    for (const s of source.data?.outline ?? []) if (!m.has(s.startLine)) m.set(s.startLine, s);
    return m;
  }, [source.data]);

  useEffect(() => {
    const host = scrollRef.current;
    if (!host || !source.data) return;
    const line = host.querySelector<HTMLElement>(`[data-line="${range?.[0] ?? 1}"]`);
    if (line) host.scrollTop = Math.max(0, line.offsetTop - host.clientHeight / 3);
  }, [range, target.nonce, source.data]);

  return (
    <div className={styles.codeViewer}>
      <div className={styles.codeHeader}>
        <CopyableValue value={range ? `${file}:${range[0]}` : file} mono maxChars={48} expandable label="File" />
        {source.data && source.data.outline.length > 0 && (
          <select
            className={styles.outlineSelect}
            aria-label="Jump to symbol"
            value=""
            onChange={(e) => {
              const s = source.data!.outline.find((o) => o.id === e.target.value);
              if (s) onSymbol(s);
            }}
          >
            <option value="" disabled>Jump to symbol ({source.data.outline.length})</option>
            {source.data.outline.map((s) => (
              <option key={s.id} value={s.id}>{s.symbol} · {s.kind} · L{s.startLine}</option>
            ))}
          </select>
        )}
      </div>

      {source.isLoading ? (
        <Skeleton height="100%" radius="sm" />
      ) : source.isError ? (
        <EmptyState icon={FileCode} title="Could not open the file" description={errorMessage(source.error)} />
      ) : source.data ? (
        <Highlight theme={THEME} code={source.data.content.replace(/\n$/, '')} language={source.data.language ?? 'text'}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <div ref={scrollRef} className={styles.codeScroll} style={style}>
              <pre className={`${className} ${styles.code}`}>
                {tokens.map((line, i) => {
                  const n = i + 1;
                  const sym = startsAt.get(n);
                  const lineProps = getLineProps({ line });
                  const inRange = range !== null && n >= range[0] && n <= range[1];
                  return (
                    <div
                      key={i}
                      {...lineProps}
                      data-line={n}
                      className={`${lineProps.className} ${styles.codeLine} ${inRange ? styles.codeLineActive : ''}`}
                    >
                      <span className={`${styles.gutter} ${lineChanged(n, changedRanges) ? styles.gutterChanged : ''}`}>
                        {sym ? (
                          <button type="button" className={styles.gutterSymbol} onClick={() => onSymbol(sym)} title={`Select ${sym.symbol}`}>
                            {n}
                          </button>
                        ) : n}
                      </span>
                      <span className={styles.codeText}>
                        {line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)}
                      </span>
                    </div>
                  );
                })}
              </pre>
            </div>
          )}
        </Highlight>
      ) : null}
    </div>
  );
}
