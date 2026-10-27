import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Highlight } from 'prism-react-renderer';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { useCodeGraphSource } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphOutlineDTO, CodeGraphSymbolRefDTO } from '../../lib/types';
import { CODE_THEME, NOT_CODE } from './CodeViewer';
import { peekBack, peekPlacement, peekPush, peekWindow, type PeekFrame } from './inspector-model';
import { splitIdentifiers, symbolIcon } from './nav-model';
import { Codicon } from './workbench/codicons';
import { ProgressLine } from './workbench/Workbench';
import styles from './Peek.module.css';

/** Hover this long before a peek opens: passing the mouse over a list must not flash code. */
const OPEN_MS = 350;
/** Grace to cross from the row to the popover. */
const CLOSE_MS = 220;

export type ResolveDeclaration = (name: string, file: string, line: number, outline: readonly CodeGraphOutlineDTO[]) => Promise<CodeGraphSymbolRefDTO[]>;

interface PeekState {
  stack: PeekFrame[];
  anchor: DOMRect;
}

/**
 * Hover intent for a peek: rows call `enter`/`leave`, the popover `keep`. Nothing it does
 * moves the editor, the selection or the history; `onHighlight` only lights a node up.
 */
export function usePeek(onHighlight?: (id: string | null) => void) {
  const [state, setState] = useState<PeekState | null>(null);
  const [pinned, setPinned] = useState(false);
  const openTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const clear = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };
  const close = useCallback(() => {
    clear();
    setState(null);
    setPinned(false);
  }, []);
  const enter = (frame: PeekFrame, el: HTMLElement) => {
    if (pinned) return;
    clear();
    const show = () => setState({ stack: [frame], anchor: el.getBoundingClientRect() });
    // Already peeking: follow the mouse down the list at once, as VSCode's hovers do once warm.
    if (state) show();
    else openTimer.current = setTimeout(show, OPEN_MS);
  };
  const leave = () => {
    clearTimeout(openTimer.current);
    if (!pinned) closeTimer.current = setTimeout(close, CLOSE_MS);
  };
  const keep = () => clearTimeout(closeTimer.current);
  // Following a name is deliberate: the peek stays until dismissed.
  const push = (frame: PeekFrame) => {
    setPinned(true);
    setState((s) => (s ? { ...s, stack: peekPush(s.stack, frame) } : s));
  };
  const back = () => setState((s) => (s ? { ...s, stack: peekBack(s.stack) } : s));
  const jump = (i: number) => setState((s) => (s ? { ...s, stack: s.stack.slice(0, i + 1) } : s));

  const top = state?.stack.at(-1)?.id ?? null;
  const highlightRef = useRef(onHighlight);
  highlightRef.current = onHighlight;
  useEffect(() => { highlightRef.current?.(top); }, [top]);
  useEffect(() => () => {
    clear();
    highlightRef.current?.(null);
  }, []);

  return { state, pinned, setPinned, enter, leave, keep, close, push, back, jump };
}

export type Peek = ReturnType<typeof usePeek>;

interface PeekPopoverProps {
  peek: Peek;
  project: string;
  revision: string | undefined;
  resolve: ResolveDeclaration;
  /** Really go there: open the frame in an editor tab. */
  onOpen: (frame: PeekFrame) => void;
}

export function PeekPopover({ peek, project, revision, resolve, onOpen }: PeekPopoverProps) {
  const { state, pinned } = peek;
  const frame = state?.stack.at(-1);
  const ref = useRef<HTMLDivElement>(null);
  const source = useCodeGraphSource(project, frame?.file ?? null, revision);
  const [notice, setNotice] = useState<{ text: string; choices: CodeGraphSymbolRefDTO[] } | null>(null);
  useEffect(() => setNotice(null), [frame?.id]);

  // Placed after layout, off its real height: above the row, or below when there is no room.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !state) return;
    const at = peekPlacement(
      state.anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.left = `${at.left}px`;
    el.style.top = `${at.top}px`;
  });

  // Alt pins, Esc closes, Enter opens, Backspace steps back; a click outside a pinned peek closes it.
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]')) return;
      if (e.key === 'Alt') peek.setPinned(true);
      else if (e.key === 'Escape') peek.close();
      else if (e.key === 'Enter' && frame) {
        e.preventDefault();
        peek.close();
        onOpen(frame);
      } else if (e.key === 'Backspace' && state.stack.length > 1) {
        e.preventDefault();
        peek.back();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) peek.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [state, frame, peek, onOpen]);

  if (!state || !frame) return null;

  const follow = (s: CodeGraphSymbolRefDTO) => peek.push({ id: s.id, label: s.symbol, file: s.file, range: [s.startLine, s.endLine] });
  const onName = async (name: string, line: number) => {
    setNotice({ text: `Resolving ${name}…`, choices: [] });
    try {
      const targets = await resolve(name, frame.file, line, source.data?.outline ?? []);
      if (targets.length === 1) follow(targets[0]);
      else setNotice({ text: targets.length ? `Choose declaration of ${name}` : `No declaration of ${name} in the index`, choices: targets });
    } catch {
      setNotice({ text: `Could not resolve ${name}`, choices: [] });
    }
  };

  const content = source.data?.content.replace(/\n$/, '') ?? '';
  const lines = content.split('\n');
  const [from, to] = peekWindow(frame.range, lines.length);
  const inSpan = (n: number) => !!frame.range && n >= frame.range[0] && n <= frame.range[1];

  // Out of the panel (its grid and overflow would clip or lay out a floating card), but inside
  // the workbench root: the --vscode-* theme variables are scoped there, not on <body>.
  return createPortal(
    <div
      ref={ref}
      className={`${styles.peek} ${pinned ? styles.pinned : ''}`}
      role="dialog"
      aria-label={`Peek ${frame.label}`}
      onMouseEnter={peek.keep}
      onMouseLeave={peek.leave}
    >
      <header className={styles.header}>
        <nav className={styles.trail} aria-label="Peek trail">
          {state.stack.map((f, i) => (
            <span key={`${f.id}:${i}`} className={styles.step}>
              {i > 0 && <Codicon name="chevron-right" className={styles.sep} />}
              <button type="button" className={styles.crumb} aria-current={i === state.stack.length - 1} onClick={() => peek.jump(i)} title={f.id}>
                {f.label}
              </button>
            </span>
          ))}
        </nav>
        <span className={styles.where} title={frame.file}>{frame.file}{frame.range ? `:${frame.range[0]}` : ''}</span>
        <VscodeToolbarButton icon={pinned ? 'pinned' : 'pin'} label={pinned ? 'Pinned (Esc closes)' : 'Pin (Alt)'} toggleable checked={pinned} onClick={() => peek.setPinned(!pinned)} />
        <VscodeToolbarButton icon="go-to-file" label="Open in editor (Enter)" onClick={() => { peek.close(); onOpen(frame); }} />
        <VscodeToolbarButton icon="close" label="Close (Esc)" onClick={peek.close} />
      </header>

      {source.isLoading ? <ProgressLine /> : source.isError ? (
        <p className={styles.notice}>Could not read {frame.file}</p>
      ) : (
        <Highlight theme={CODE_THEME} code={lines.slice(from - 1, to).join('\n')} language={source.data?.language ?? 'text'}>
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={`${className} ${styles.code}`}
              style={style}
              onClick={(e) => {
                // A drag selects text; only a plain click follows the name.
                if (!window.getSelection()?.isCollapsed) return;
                const el = e.target as HTMLElement;
                const ident = el.closest<HTMLElement>('[data-ident]');
                const line = Number(el.closest<HTMLElement>('[data-line]')?.dataset.line);
                if (ident?.textContent && line) void onName(ident.textContent, line);
              }}
            >
              {tokens.map((line, i) => {
                const n = from + i;
                const lineProps = getLineProps({ line });
                return (
                  <div key={n} {...lineProps} data-line={n} className={`${lineProps.className} ${styles.line} ${inSpan(n) ? styles.span : ''}`}>
                    <span className={styles.gutter}>{n}</span>
                    <span>
                      {line.map((token, j) => (
                        token.types.some((t) => NOT_CODE.has(t))
                          ? <span key={j} {...getTokenProps({ token })} />
                          : (
                            <span key={j} {...getTokenProps({ token })}>
                              {splitIdentifiers(token.content).map((p, k) => (p.ident ? <span key={k} data-ident="" className={styles.ident}>{p.text}</span> : p.text))}
                            </span>
                          )
                      ))}
                    </span>
                  </div>
                );
              })}
              {frame.range && to < Math.min(frame.range[1], lines.length) && (
                <div className={styles.more}>… {frame.range[1] - to} more lines — Enter opens it</div>
              )}
            </pre>
          )}
        </Highlight>
      )}

      {notice && (
        <div className={styles.notice}>
          <span>{notice.text}</span>
          {notice.choices.map((c) => (
            <button key={c.id} type="button" className={styles.choice} onClick={() => follow(c)} title={c.id}>
              <Codicon name={symbolIcon(c.kind)} /> {c.symbol} <span className={styles.dim}>{c.file}:{c.startLine}</span>
            </button>
          ))}
        </div>
      )}
      <footer className={styles.footer}>
        Click a name to follow it · Backspace back · Alt pins · Enter opens · Esc closes
      </footer>
    </div>,
    document.querySelector('.vsc-dark-modern') ?? document.body,
  );
}
