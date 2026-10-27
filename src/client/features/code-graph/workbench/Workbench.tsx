import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import VscodeProgressBar from '@vscode-elements/react-elements/dist/components/VscodeProgressBar.js';
import { Codicon } from './codicons';
import './vscode-dark-modern.css';
import styles from './Workbench.module.css';

/**
 * The VSCode workbench frame: title bar, activity bar, primary side bar, editor group,
 * panel (below the editor), auxiliary side bar and status bar. Purely presentational:
 * every part is a slot.
 * Parts keep their position in the tree when hidden, so the editor (and its WebGL
 * canvas) never remounts when a side bar is toggled.
 */
export function Workbench({ titleBar, activityBar, sideBar, editor, panel = null, panelCollapsed = false, auxBar = null, statusBar }: {
  titleBar: ReactNode;
  activityBar: ReactNode;
  sideBar: ReactNode | null;
  editor: ReactNode;
  /** The bottom panel, as VSCode's: spans the editor group and resizes vertically. */
  panel?: ReactNode | null;
  /** Shrink the panel to its header (nothing to show yet). */
  panelCollapsed?: boolean;
  auxBar?: ReactNode | null;
  statusBar: ReactNode;
}) {
  const start = useSash(260, 170, 600);
  const end = useSash(340, 220, 720);
  const bottom = useSash(260, 120, 640);
  return (
    <div className={`vsc-dark-modern ${styles.root}`}>
      {titleBar}
      <div className={styles.body}>
        {activityBar}
        {sideBar ? (
          <aside className={`${styles.sideBar} ${styles.sideBarStart}`} style={{ width: start.size }}>
            {sideBar}
            <Sash side="start" {...start} />
          </aside>
        ) : <span />}
        <div className={styles.center}>
          <main className={styles.editor}>{editor}</main>
          {panel && (
            <section
              className={styles.panel}
              style={{ height: panelCollapsed ? undefined : bottom.size }}
              aria-label="Panel"
            >
              {!panelCollapsed && <Sash side="top" {...bottom} />}
              {panel}
            </section>
          )}
        </div>
        {auxBar ? (
          <aside className={`${styles.sideBar} ${styles.sideBarEnd}`} style={{ width: end.size }}>
            <Sash side="end" {...end} />
            {auxBar}
          </aside>
        ) : <span />}
      </div>
      {statusBar}
    </div>
  );
}

/** A resizable part size, driven by a sash. */
export function useSash(initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, n)), [min, max]);
  return { size, setSize, clamp, initial };
}

export function Sash({ side, size, setSize, clamp, initial, style }: { side: 'start' | 'end' | 'between' | 'top'; style?: CSSProperties } & ReturnType<typeof useSash>) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const [active, setActive] = useState(false);
  // The end bar grows leftwards and the panel upwards: dragging towards them makes them bigger.
  const sign = side === 'end' || side === 'top' ? -1 : 1;
  const horizontal = side === 'top';
  const sideClass = side === 'start' ? styles.sashStart
    : side === 'end' ? styles.sashEnd
      : side === 'top' ? styles.sashTop : styles.sashBetween;
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={size}
      data-active={active}
      style={style}
      className={`${styles.sash} ${sideClass}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { at: horizontal ? e.clientY : e.clientX, size };
        setActive(true);
      }}
      onPointerMove={(e) => {
        if (drag.current) setSize(clamp(drag.current.size + sign * ((horizontal ? e.clientY : e.clientX) - drag.current.at)));
      }}
      onPointerUp={() => { drag.current = null; setActive(false); }}
      onDoubleClick={() => setSize(initial)}
    />
  );
}

export interface ActivityItem {
  id: string;
  icon: string;
  label: string;
  badge?: number;
}

/** Clicking the active item collapses the side bar, as in VSCode. */
export function ActivityBar({ items, active, onSelect }: {
  items: ActivityItem[];
  active: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <nav className={styles.activityBar} aria-label="Views">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.activityItem}
          aria-pressed={active === item.id}
          title={item.label}
          aria-label={item.label}
          onClick={() => onSelect(active === item.id ? null : item.id)}
        >
          <Codicon name={item.icon} />
          {!!item.badge && <span className={styles.activityBadge}>{item.badge}</span>}
        </button>
      ))}
      <span className={styles.activitySpacer} />
      <Link to="/" className={styles.activityItem} title="Back to the dashboard" aria-label="Back to the dashboard">
        <Codicon name="home" />
      </Link>
    </nav>
  );
}

/** A side bar view: uppercase 35px title with actions, then the scrollable body. */
export function Pane({ title, actions, loading, children }: {
  title: string;
  actions?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <header className={styles.paneHeader}>
        <h2 className={styles.paneTitle}>{title}</h2>
        {actions && <div className={styles.paneActions}>{actions}</div>}
      </header>
      <div className={styles.paneBody}>
        {loading && <ProgressLine />}
        {children}
      </div>
    </>
  );
}

/** VSCode's indeterminate progress line along the top of a part. */
export function ProgressLine() {
  return <VscodeProgressBar className={styles.progress} indeterminate />;
}

/** Empty/error state of a part: a faded codicon and a short message. */
export function Placeholder({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className={styles.placeholder} role="status">
      <Codicon name={icon} />
      <p className={styles.placeholderTitle}>{title}</p>
      {children && <p className={styles.placeholderText}>{children}</p>}
    </div>
  );
}

export function TitleBar({ start, center, end }: { start: ReactNode; center: ReactNode; end: ReactNode }) {
  return (
    <header className={styles.titleBar}>
      <div className={styles.titleStart}>
        <Codicon name="type-hierarchy-sub" className={styles.appIcon} title="ctk code graph" />
        {start}
      </div>
      <div className={styles.commandCenter}>{center}</div>
      <div className={styles.titleEnd}>{end}</div>
    </header>
  );
}

export function StatusBar({ start, end }: { start: ReactNode; end: ReactNode }) {
  return (
    <footer className={styles.statusBar}>
      <div className={styles.statusGroup}>{start}</div>
      <div className={styles.statusGroup}>{end}</div>
    </footer>
  );
}

/** A status bar entry: a button when it has an action, plain text otherwise. */
export function StatusItem({ icon, children, title, onClick, pressed, variant }: {
  icon?: string;
  children?: ReactNode;
  title?: string;
  onClick?: () => void;
  /** For toggles: dims the item while off. */
  pressed?: boolean;
  variant?: 'remote' | 'warn' | 'active';
}) {
  const variantClass = variant === 'remote' ? styles.statusRemote
    : variant === 'warn' ? styles.statusWarn
      : variant === 'active' ? styles.statusActive : '';
  const content = <>{icon && <Codicon name={icon} />}{children}</>;
  const className = `${styles.statusItem} ${variantClass}`;
  return onClick ? (
    <button type="button" className={className} title={title} onClick={onClick} aria-pressed={pressed}>
      {content}
    </button>
  ) : (
    <span className={className} title={title}>{content}</span>
  );
}

export interface Crumb {
  key: string;
  label: string;
  icon?: string;
  onClick?: () => void;
}

/** Editor breadcrumbs: path segments with chevrons, plus trailing widgets. */
export function Breadcrumbs({ crumbs, children }: { crumbs: Crumb[]; children?: ReactNode }) {
  return (
    <nav className={styles.breadcrumbs} aria-label="Breadcrumbs">
      {crumbs.map((c, i) => (
        <span key={c.key} className={styles.crumb}>
          {i > 0 && <Codicon name="chevron-right" className={styles.crumbSep} />}
          <button type="button" className={styles.crumb} onClick={c.onClick} disabled={!c.onClick}>
            {c.icon && <Codicon name={c.icon} />}
            {c.label}
          </button>
        </span>
      ))}
      {children && <div className={styles.breadcrumbsEnd}>{children}</div>}
    </nav>
  );
}
