import { useEffect, useMemo, useRef } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { useCodeGraphDiff } from '../../hooks/queries/useCodeGraph';
import { diffRows, firstChangeIndex, type DiffRow } from './diff-model';
import { Breadcrumbs, Placeholder, ProgressLine } from './workbench/Workbench';
import styles from './CodeViewer.module.css';

interface DiffViewerProps {
  project: string;
  file: string;
  base: string | undefined;
  worktree: boolean;
  revision: string | undefined;
  /** New-side span to scroll to (a changed symbol); `nonce` re-scrolls to the same span. */
  target: { range: [number, number] | null; nonce: number };
  /** Leave the diff for the whole file in the code viewer. */
  onOpenSource: () => void;
  onScope: (dir: string) => void;
  errorMessage: (err: unknown) => string;
}

const THEME = { ...themes.vsDark, plain: { ...themes.vsDark.plain, backgroundColor: 'var(--vscode-editor-background)' } };
const MARK = { add: '+', del: '−', context: ' ' } as const;
const LINE_CLASS = { add: styles.diffAdd, del: styles.diffDel, context: '' } as const;

type LineRow = Extract<DiffRow, { type: 'line' }>;
const isLine = (r: DiffRow | undefined): r is LineRow => r?.type === 'line';
const isChange = (r: DiffRow | undefined) => isLine(r) && r.line.kind !== 'context';

/** Unified review diff: hunks of one file vs the branch base, both sides numbered, syntax-highlighted. */
export function DiffViewer({ project, file, base, worktree, revision, target, onOpenSource, onScope, errorMessage }: DiffViewerProps) {
  const diff = useCodeGraphDiff(project, file, base, worktree, revision);
  const rows = useMemo(() => diffRows(diff.data?.hunks ?? []), [diff.data]);
  // All lines highlighted as one text, so a token split over lines keeps its grammar state.
  const code = useMemo(() => rows.filter(isLine).map((r) => r.line.text).join('\n'), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // First row of each block of consecutive changes: the stops of next/previous change.
  const changes = useMemo(() => rows.flatMap((r, i) => (isChange(r) && !isChange(rows[i - 1]) ? [i] : [])), [rows]);

  const scrollToRow = (i: number) => {
    const host = scrollRef.current;
    const el = host?.querySelector<HTMLElement>(`[data-row="${i}"]`);
    if (host && el) host.scrollTop = Math.max(0, el.offsetTop - host.clientHeight / 3);
  };

  useEffect(() => {
    if (!diff.data) return;
    const i = firstChangeIndex(rows, target.range?.[0] ?? null);
    if (i >= 0) scrollToRow(i);
  }, [rows, target.range, target.nonce, diff.data]);

  // Next/previous block of changes, relative to what is on screen now.
  const step = (dir: 1 | -1) => {
    const host = scrollRef.current;
    if (!host || changes.length === 0) return;
    const top = host.scrollTop + host.clientHeight / 3;
    const offsets = changes.map((i) => host.querySelector<HTMLElement>(`[data-row="${i}"]`)?.offsetTop ?? 0);
    const k = dir === 1 ? offsets.findIndex((o) => o > top + 1) : offsets.map((o) => o < top - 1).lastIndexOf(true);
    scrollToRow(changes[k >= 0 ? k : dir === 1 ? 0 : changes.length - 1]);
  };

  const parts = file.split('/');
  const crumbs = parts.map((part, i) => {
    const dir = parts.slice(0, i + 1).join('/');
    const isFile = i === parts.length - 1;
    return { key: dir, label: part, icon: isFile ? 'diff' : undefined, onClick: isFile ? undefined : () => onScope(dir) };
  });

  const d = diff.data;
  return (
    <div className={styles.viewer}>
      <Breadcrumbs crumbs={crumbs}>
        {d && (
          <span className={styles.diffMeta}>
            {d.status === 'added' ? 'new file' : d.status === 'deleted' ? 'deleted' : 'modified'} · vs {d.base}{d.worktree ? ' + uncommitted' : ''}
          </span>
        )}
        <VscodeToolbarButton icon="arrow-up" label="Previous change" onClick={() => step(-1)} />
        <VscodeToolbarButton icon="arrow-down" label="Next change" onClick={() => step(1)} />
        {d?.status !== 'deleted' && <VscodeToolbarButton icon="go-to-file" label="Open the whole file" onClick={onOpenSource} />}
      </Breadcrumbs>

      {diff.isLoading ? (
        <div className={styles.loading}><ProgressLine /></div>
      ) : diff.isError ? (
        <Placeholder icon="error" title="Could not load the diff">{errorMessage(diff.error)}</Placeholder>
      ) : !d ? null : d.binary ? (
        <Placeholder icon="file-binary" title="Binary file">The diff of a binary file is not shown.</Placeholder>
      ) : rows.length === 0 ? (
        <Placeholder icon="check" title="No textual changes">Only the mode or name of this file changed.</Placeholder>
      ) : (
        <Highlight theme={THEME} code={code} language={d.language ?? 'text'}>
          {({ className, style, tokens, getTokenProps }) => {
            let t = 0;
            return (
              <div ref={scrollRef} className={styles.scroll} style={style}>
                <pre className={`${className} ${styles.code}`}>
                  {rows.map((r, i) => {
                    if (r.type === 'hunk') {
                      return (
                        <div key={i} data-row={i} className={`${styles.line} ${styles.diffHunk}`}>
                          <span className={styles.diffGutter} />
                          <span className={styles.text}>
                            {r.skipped > 0 ? `⋯ ${r.skipped} unchanged line${r.skipped === 1 ? '' : 's'}` : '⋯'}
                            {r.section && <span className={styles.diffSection}> · {r.section}</span>}
                          </span>
                        </div>
                      );
                    }
                    const { kind, old, new: now } = r.line;
                    const line = tokens[t++] ?? [];
                    return (
                      <div key={i} data-row={i} className={`${styles.line} ${LINE_CLASS[kind]}`}>
                        <span className={styles.diffGutter}>
                          <span>{old ?? ''}</span>
                          <span>{now ?? ''}</span>
                        </span>
                        <span className={styles.diffMark}>{MARK[kind]}</span>
                        <span className={styles.text}>
                          {line.map((token, j) => <span key={j} {...getTokenProps({ token })} />)}
                        </span>
                      </div>
                    );
                  })}
                </pre>
              </div>
            );
          }}
        </Highlight>
      )}
    </div>
  );
}
