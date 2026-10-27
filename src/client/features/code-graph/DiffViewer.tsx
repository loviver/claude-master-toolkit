import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Highlight, themes } from 'prism-react-renderer';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { useCodeGraphDiff } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphChangeDTO, CodeGraphProvenanceDTO } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';
import { sessionTurnHref } from '../session-detail/code-graph-link';
import { diffRows, firstChangeIndex, hunkSymbols, inlineChanges, markTokens, type DiffRow, type HunkSymbol } from './diff-model';
import { Codicon } from '../../shell/workbench/codicons';
import { Breadcrumbs, Placeholder, ProgressLine } from '../../shell/workbench/Workbench';
import styles from './CodeViewer.module.css';

interface DiffViewerProps {
  project: string;
  file: string;
  base: string | undefined;
  worktree: boolean;
  revision: string | undefined;
  /** New-side span to scroll to (a changed symbol); `nonce` re-scrolls to the same span. */
  target: { range: [number, number] | null; nonce: number };
  /** The branch's changed symbols (all files): each hunk names the ones it touches. */
  changes: CodeGraphChangeDTO[];
  /** Inspect a changed symbol (details pane), keeping the diff open. */
  onInspect: (change: CodeGraphChangeDTO) => void;
  /** Impact view of a changed symbol: what its callers put at risk. */
  onImpact: (id: string) => void;
  /** Leave the diff for the whole file in the code viewer. */
  onOpenSource: () => void;
  onScope: (dir: string) => void;
  errorMessage: (err: unknown) => string;
}

const THEME = { ...themes.vsDark, plain: { ...themes.vsDark.plain, backgroundColor: 'var(--vscode-editor-background)' } };
const MARK = { add: '+', del: '−', context: ' ' } as const;
const LINE_CLASS = { add: styles.diffAdd, del: styles.diffDel, context: '' } as const;
const WORD_CLASS = { add: styles.diffWordAdd, del: styles.diffWordDel, context: '' } as const;

type LineRow = Extract<DiffRow, { type: 'line' }>;
const isLine = (r: DiffRow | undefined): r is LineRow => r?.type === 'line';
const isChange = (r: DiffRow | undefined) => isLine(r) && r.line.kind !== 'context';

/** Unified review diff: hunks of one file vs the branch base, both sides numbered, syntax-highlighted. */
export function DiffViewer({ project, file, base, worktree, revision, target, changes, onInspect, onImpact, onOpenSource, onScope, errorMessage }: DiffViewerProps) {
  const navigate = useNavigate();
  const diff = useCodeGraphDiff(project, file, base, worktree, revision);
  const rows = useMemo(() => diffRows(diff.data?.hunks ?? []), [diff.data]);
  const words = useMemo(() => inlineChanges(rows), [rows]);
  const symbols = useMemo(() => hunkSymbols(rows, changes, file), [rows, changes, file]);
  // New-side line → the agent turn that wrote the block it belongs to.
  const written = useMemo(() => {
    const byLine = new Map<number, CodeGraphProvenanceDTO>();
    for (const p of diff.data?.provenance ?? []) for (let l = p.start; l <= p.end; l++) byLine.set(l, p);
    return byLine;
  }, [diff.data]);
  const addedLines = useMemo(() => rows.filter((r) => isLine(r) && r.line.kind === 'add').length, [rows]);
  // All lines highlighted as one text, so a token split over lines keeps its grammar state.
  const code = useMemo(() => rows.filter(isLine).map((r) => r.line.text).join('\n'), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // First row of each block of consecutive changes: the stops of next/previous change.
  const stops = useMemo(() => rows.flatMap((r, i) => (isChange(r) && !isChange(rows[i - 1]) ? [i] : [])), [rows]);

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
    if (!host || stops.length === 0) return;
    const top = host.scrollTop + host.clientHeight / 3;
    const offsets = stops.map((i) => host.querySelector<HTMLElement>(`[data-row="${i}"]`)?.offsetTop ?? 0);
    const k = dir === 1 ? offsets.findIndex((o) => o > top + 1) : offsets.map((o) => o < top - 1).lastIndexOf(true);
    scrollToRow(stops[k >= 0 ? k : dir === 1 ? 0 : stops.length - 1]);
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
            {written.size > 0 && (
              <span className={styles.diffAiMeta} title="Added lines matched to the agent edit that wrote them">
                {' · '}<Codicon name="sparkle" /> {written.size}/{addedLines} by AI
              </span>
            )}
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
                            {symbols.get(i)?.map((h) => <SymbolChip key={h.change.id} hit={h} onInspect={onInspect} onImpact={onImpact} />)}
                          </span>
                        </div>
                      );
                    }
                    const { kind, old, new: now } = r.line;
                    const line = tokens[t++] ?? [];
                    const by = kind === 'add' && now !== null ? written.get(now) : undefined;
                    return (
                      <div key={i} data-row={i} className={`${styles.line} ${LINE_CLASS[kind]}${by ? ` ${styles.diffAiLine}` : ''}`}>
                        <span className={styles.diffGutter}>
                          <span>{old ?? ''}</span>
                          <span>{now ?? ''}</span>
                        </span>
                        <span className={styles.diffMark}>{MARK[kind]}</span>
                        <span className={styles.text}>
                          {markTokens(line, words.get(i) ?? []).map(({ token, changed }, j) => {
                            const props = getTokenProps({ token });
                            return <span key={j} {...props} className={changed ? `${props.className} ${WORD_CLASS[kind]}` : props.className} />;
                          })}
                        </span>
                        {by && by.start === now && (
                          <button
                            type="button"
                            className={styles.diffAi}
                            title={`Lines ${by.start}–${by.end} written by ${by.tool} in session ${by.sessionId}, turn ${by.eventId}: open that turn`}
                            onClick={() => navigate(sessionTurnHref(by.sessionId, by.eventId))}
                          >
                            <Codicon name="sparkle" /> {by.tool} · {by.timestamp ? formatRelativeTime(by.timestamp) : `turn ${by.eventId}`}
                          </button>
                        )}
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

/** A changed symbol in a hunk header: inspect it, see a changed declaration, open its impact. */
function SymbolChip({ hit: { change, declaration }, onInspect, onImpact }: {
  hit: HunkSymbol;
  onInspect: (change: CodeGraphChangeDTO) => void;
  onImpact: (id: string) => void;
}) {
  // A changed first line of an exported symbol is a contract change for every caller.
  const breaking = declaration && change.exported && change.callers.length > 0;
  return (
    <span className={styles.diffSymbol}>
      <button type="button" className={styles.diffSymbolName} title={`Inspect ${change.symbol}`} onClick={() => onInspect(change)}>
        <Codicon name="symbol-method" /> {change.symbol}
      </button>
      {declaration && (
        <span className={breaking ? styles.diffBreaking : undefined} title="The diff reaches the declaration line: signature, props or parameters">
          {breaking && <Codicon name="warning" />} declaration changed
        </span>
      )}
      {change.callers.length > 0 && (
        <button type="button" className={styles.diffSymbolName} title="Impact view: the untouched callers this change puts at risk" onClick={() => onImpact(change.id)}>
          <Codicon name="references" /> {change.callers.length} caller{change.callers.length === 1 ? '' : 's'}
        </button>
      )}
    </span>
  );
}
