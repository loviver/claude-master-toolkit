import { useEffect, useMemo, useRef, useState } from 'react';
import { Highlight, themes } from 'prism-react-renderer';
import VscodeSingleSelect from '@vscode-elements/react-elements/dist/components/VscodeSingleSelect.js';
import VscodeOption from '@vscode-elements/react-elements/dist/components/VscodeOption.js';
import { useCodeGraphSource } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphOutlineDTO } from '../../lib/types';
import { lineChanged } from './explorer-model';
import { innermostAt, splitIdentifiers } from './nav-model';
import { Breadcrumbs, Placeholder, ProgressLine } from './workbench/Workbench';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
  project: string;
  file: string;
  revision: string | undefined;
  /** Lines to highlight and scroll to (a symbol's span); `nonce` re-scrolls to the same span. */
  target: { range: [number, number] | null; nonce: number };
  /** Lines the diff touches, marked in the gutter. */
  changedRanges: ReadonlyArray<readonly [number, number]>;
  onSymbol: (symbol: CodeGraphOutlineDTO) => void;
  /** Ctrl/Cmd+click on an identifier: go to its declaration (or its usages, on the declaration itself). */
  onGoToDeclaration: (name: string, line: number) => void;
  /** A plain click on a line: where the caret is, for linking the graph selection to the code. */
  onCaret?: (line: number) => void;
  /** A folder breadcrumb was clicked: narrow the graph to it. */
  onScope: (dir: string) => void;
  errorMessage: (err: unknown) => string;
}

/** VSCode's Dark+ token colors on the theme's editor background. */
export const CODE_THEME = { ...themes.vsDark, plain: { ...themes.vsDark.plain, backgroundColor: 'var(--vscode-editor-background)' } };

/** Token types whose text is never a reference to a symbol. */
export const NOT_CODE = new Set(['comment', 'string', 'template-string', 'char', 'regex', 'number', 'boolean', 'keyword', 'builtin', 'url']);

/** True while Ctrl/Cmd is held: identifiers turn into links, as in an IDE. */
function useLinkModifier(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => setHeld(e.ctrlKey || e.metaKey);
    const release = () => setHeld(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', release);
    };
  }, []);
  return held;
}

export function CodeViewer({
  project, file, revision, target, changedRanges, onSymbol, onGoToDeclaration, onCaret, onScope, errorMessage,
}: CodeViewerProps) {
  const source = useCodeGraphSource(project, file, revision);
  const linking = useLinkModifier();
  const scrollRef = useRef<HTMLDivElement>(null);
  const range = target.range;
  const outline = source.data?.outline ?? [];

  // Symbols by first line, so the gutter can mark where each one starts.
  const startsAt = useMemo(() => {
    const m = new Map<number, CodeGraphOutlineDTO>();
    for (const s of outline) if (!m.has(s.startLine)) m.set(s.startLine, s);
    return m;
  }, [outline]);
  // The breadcrumb symbol is the innermost one around the target line, as in VSCode.
  const current = useMemo(() => (range ? innermostAt(outline, range[0]) : undefined), [outline, range]);

  useEffect(() => {
    const host = scrollRef.current;
    if (!host || !source.data) return;
    const line = host.querySelector<HTMLElement>(`[data-line="${range?.[0] ?? 1}"]`);
    if (line) host.scrollTop = Math.max(0, line.offsetTop - host.clientHeight / 3);
  }, [range, target.nonce, source.data]);

  const parts = file.split('/');
  const crumbs = parts.map((part, i) => {
    const isFile = i === parts.length - 1;
    const dir = parts.slice(0, i + 1).join('/');
    return {
      key: dir,
      label: part,
      icon: isFile ? 'file-code' : undefined,
      onClick: isFile ? undefined : () => onScope(dir),
    };
  });

  return (
    <div className={styles.viewer}>
      <Breadcrumbs crumbs={crumbs}>
        {outline.length > 0 && (
          <VscodeSingleSelect
            className={styles.outline}
            aria-label="Go to symbol"
            value={current?.id ?? ''}
            onChange={(e) => {
              const s = outline.find((o) => o.id === (e.target as HTMLSelectElement).value);
              if (s) onSymbol(s);
            }}
          >
            <VscodeOption value="">Go to symbol ({outline.length})</VscodeOption>
            {outline.map((s) => (
              <VscodeOption key={s.id} value={s.id} description={`${s.kind} · L${s.startLine}`}>{s.symbol}</VscodeOption>
            ))}
          </VscodeSingleSelect>
        )}
      </Breadcrumbs>

      {source.isLoading ? (
        <div className={styles.loading}><ProgressLine /></div>
      ) : source.isError ? (
        <Placeholder icon="error" title="Could not open the file">{errorMessage(source.error)}</Placeholder>
      ) : source.data ? (
        <Highlight theme={CODE_THEME} code={source.data.content.replace(/\n$/, '')} language={source.data.language ?? 'text'}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <div ref={scrollRef} className={`${styles.scroll} ${linking ? styles.linking : ''}`} style={style}>
              <pre
                className={`${className} ${styles.code}`}
                onClick={(e) => {
                  const el = e.target as HTMLElement;
                  if (!e.ctrlKey && !e.metaKey) {
                    const caret = Number(el.closest<HTMLElement>('[data-line]')?.dataset.line);
                    if (caret) onCaret?.(caret);
                    return;
                  }
                  const ident = el.closest<HTMLElement>('[data-ident]');
                  const line = Number(el.closest<HTMLElement>('[data-line]')?.dataset.line);
                  if (!ident?.textContent || !line) return;
                  e.preventDefault();
                  onGoToDeclaration(ident.textContent, line);
                }}
              >
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
                      className={`${lineProps.className} ${styles.line} ${inRange ? styles.lineActive : ''}`}
                    >
                      <span className={styles.gutter}>
                        {sym ? (
                          <button type="button" className={styles.gutterSymbol} onClick={() => onSymbol(sym)} title={`Select ${sym.symbol}`}>
                            {n}
                          </button>
                        ) : n}
                      </span>
                      <span className={`${styles.dirty} ${lineChanged(n, changedRanges) ? styles.dirtyOn : ''}`} />
                      <span className={styles.text}>
                        {line.map((token, j) => (
                          token.types.some((t) => NOT_CODE.has(t))
                            ? <span key={j} {...getTokenProps({ token })} />
                            : (
                              <span key={j} {...getTokenProps({ token })}>
                                {splitIdentifiers(token.content).map((p, k) => (p.ident ? <span key={k} data-ident="">{p.text}</span> : p.text))}
                              </span>
                            )
                        ))}
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
