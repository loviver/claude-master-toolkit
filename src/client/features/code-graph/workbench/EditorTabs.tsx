import type { ReactNode } from 'react';
import { Codicon } from './codicons';
import { GRAPH_TAB, type EditorState } from '../workbench-model';
import styles from './Workbench.module.css';

const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);

/** Editor group header: the pinned graph tab, open file tabs, and the editor actions. */
export function EditorTabs({ state, graphLabel, modified, onActivate, onClose, onPin, actions }: {
  state: EditorState;
  graphLabel: string;
  /** Files the diff touches, decorated like VSCode's git-modified tabs. */
  modified: ReadonlySet<string>;
  onActivate: (id: string) => void;
  onClose: (file: string) => void;
  onPin: (file: string) => void;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.tabsBar}>
      <div className={styles.tabs} role="tablist" aria-label="Open editors">
        {!state.split && <div
          role="tab"
          tabIndex={0}
          className={styles.tab}
          aria-selected={state.active === GRAPH_TAB}
          onClick={() => onActivate(GRAPH_TAB)}
          onKeyDown={(e) => { if (e.key === 'Enter') onActivate(GRAPH_TAB); }}
          title="Code graph"
        >
          <Codicon name="type-hierarchy-sub" />
          <span className={styles.tabLabel}>{graphLabel}</span>
          <Codicon name="pinned" className={styles.tabPinned} />
        </div>}
        {state.tabs.map((tab) => {
          const changed = modified.has(tab.file);
          return (
            <div
              key={tab.file}
              role="tab"
              tabIndex={0}
              className={`${styles.tab} ${tab.preview ? styles.tabPreview : ''}`}
              aria-selected={state.active === tab.file}
              title={tab.file}
              onClick={() => onActivate(tab.file)}
              onDoubleClick={() => onPin(tab.file)}
              // Middle click closes, as in VSCode.
              onAuxClick={(e) => { if (e.button === 1) onClose(tab.file); }}
              onKeyDown={(e) => { if (e.key === 'Enter') onActivate(tab.file); }}
            >
              <Codicon name="file-code" />
              <span className={`${styles.tabLabel} ${changed ? styles.tabModified : ''}`}>{basename(tab.file)}</span>
              <button
                type="button"
                className={styles.tabClose}
                aria-label={`Close ${basename(tab.file)}`}
                onClick={(e) => { e.stopPropagation(); onClose(tab.file); }}
              >
                <Codicon name="close" />
              </button>
            </div>
          );
        })}
      </div>
      {actions && <div className={styles.editorActions}>{actions}</div>}
    </div>
  );
}
