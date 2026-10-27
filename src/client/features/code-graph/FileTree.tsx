import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import VscodeTextfield from '@vscode-elements/react-elements/dist/components/VscodeTextfield.js';
import type { CodeGraphFileDTO } from '../../lib/types';
import { ancestorDirs, buildFileTree, matchFiles, type TreeDir } from './explorer-model';
import { Codicon } from '../../shell/workbench/codicons';
import list from '../../shell/workbench/list.module.css';
import { revealRow } from '../../shell/workbench/reveal';
import styles from './Panels.module.css';

interface FileTreeProps {
  files: CodeGraphFileDTO[];
  changed: ReadonlySet<string>;
  activeFile: string | null;
  /** Single click: preview the file. */
  onOpenFile: (file: string) => void;
  /** Double click: open it in a regular (pinned) tab. */
  onPinFile: (file: string) => void;
  /** Narrow the graph to a folder. */
  onScope: (dir: string) => void;
  /** Show the impact view of everything under a folder. */
  onImpact: (dir: string) => void;
}

/** VSCode tree geometry: 8px per level on top of the 8px row inset. */
const indent = (depth: number): CSSProperties => ({ '--row-indent': `${8 + depth * 8}px` } as CSSProperties);

function DirRows({ dir, depth, expanded, toggle, activeFile, onOpenFile, onPinFile, onScope, onImpact }: {
  dir: TreeDir;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
} & Pick<FileTreeProps, 'activeFile' | 'onOpenFile' | 'onPinFile' | 'onScope' | 'onImpact'>) {
  return (
    <>
      {dir.dirs.map((d) => {
        const open = expanded.has(d.path);
        return (
          <li key={d.path}>
            <div
              role="treeitem"
              tabIndex={0}
              aria-expanded={open}
              className={list.row}
              style={indent(depth)}
              title={`${d.path} · ${d.fileCount} files`}
              onClick={() => toggle(d.path)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(d.path); } }}
            >
              <span className={list.twistie}><Codicon name={open ? 'chevron-down' : 'chevron-right'} /></span>
              <span className={`${list.label} ${d.changed > 0 ? list.modified : ''}`}>{d.name}</span>
              <span className={list.actions}>
                <button
                  type="button"
                  className={list.action}
                  title={`Impact of ${d.path}: what uses it`}
                  aria-label={`Impact of ${d.path}`}
                  onClick={(e) => { e.stopPropagation(); onImpact(d.path); }}
                >
                  <Codicon name="target" />
                </button>
                <button
                  type="button"
                  className={list.action}
                  title={`Show only ${d.path} in the graph`}
                  aria-label={`Show only ${d.path} in the graph`}
                  onClick={(e) => { e.stopPropagation(); onScope(d.path); }}
                >
                  <Codicon name="filter" />
                </button>
              </span>
              {d.changed > 0 && <span className={`${list.decoration} ${list.modified}`} title={`${d.changed} changed`}>●</span>}
            </div>
            {open && (
              <ul className={list.list} role="group">
                <DirRows
                  dir={d} depth={depth + 1} expanded={expanded} toggle={toggle}
                  activeFile={activeFile} onOpenFile={onOpenFile} onPinFile={onPinFile} onScope={onScope} onImpact={onImpact}
                />
              </ul>
            )}
          </li>
        );
      })}
      {dir.files.map((f) => (
        <li key={f.path}>
          <FileRow
            file={f.path} name={f.name} changed={f.changed} symbols={f.symbols} style={indent(depth)}
            active={f.path === activeFile} onOpenFile={onOpenFile} onPinFile={onPinFile}
          />
        </li>
      ))}
    </>
  );
}

function FileRow({ file, name, description, changed, symbols, style, active, onOpenFile, onPinFile }: {
  file: string;
  name: string;
  description?: string;
  changed: boolean;
  symbols?: number;
  style?: CSSProperties;
  active: boolean;
} & Pick<FileTreeProps, 'onOpenFile' | 'onPinFile'>) {
  return (
    <div
      role="treeitem"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      ref={active ? revealRow : undefined}
      className={list.row}
      style={style}
      title={symbols ? `${file} · ${symbols} symbols` : file}
      onClick={() => onOpenFile(file)}
      onDoubleClick={() => onPinFile(file)}
      onKeyDown={(e) => { if (e.key === 'Enter') onPinFile(file); }}
    >
      <span className={list.twistie} />
      <Codicon name="file-code" className={`${list.icon} ${styles.fileIcon}`} />
      <span className={`${list.label} ${changed ? list.modified : ''}`}>{name}</span>
      {description && <span className={list.description}>{description}</span>}
      {changed && <span className={`${list.decoration} ${list.modified}`} title="Modified">M</span>}
    </div>
  );
}

const dirname = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const basename = (file: string) => file.slice(file.lastIndexOf('/') + 1);

export function FileTree({ files, changed, activeFile, onOpenFile, onPinFile, onScope, onImpact }: FileTreeProps) {
  const tree = useMemo(() => buildFileTree(files, changed), [files, changed]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.dirs.map((d) => d.path)));
  const [query, setQuery] = useState('');
  const matches = useMemo(() => matchFiles(files, query), [files, query]);

  // Reveal the active file: expand every folder above it (compact folders included).
  useEffect(() => {
    if (!activeFile) return;
    setExpanded((prev) => {
      const missing = ancestorDirs(activeFile).filter((d) => !prev.has(d));
      return missing.length ? new Set([...prev, ...missing]) : prev;
    });
  }, [activeFile]);

  const toggle = (path: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(path)) next.add(path);
    return next;
  });

  return (
    <>
      <div className={styles.filter}>
        <VscodeTextfield
          type="search"
          placeholder={`Filter ${files.length.toLocaleString()} files`}
          aria-label="Filter files"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) onPinFile(matches[0].file); }}
        >
          <Codicon name="filter" className={styles.filterIcon} slot="content-before" />
        </VscodeTextfield>
      </div>
      {query.trim() ? (
        <ul className={list.list} role="tree" aria-label="Matching files">
          {matches.length === 0 && <li className={list.empty}>No file matches</li>}
          {matches.map((f) => (
            <li key={f.file}>
              <FileRow
                file={f.file} name={basename(f.file)} description={dirname(f.file)} changed={changed.has(f.file)}
                active={f.file === activeFile} onOpenFile={onOpenFile} onPinFile={onPinFile}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul className={list.list} role="tree" aria-label="Files">
          <DirRows
            dir={tree} depth={0} expanded={expanded} toggle={toggle}
            activeFile={activeFile} onOpenFile={onOpenFile} onPinFile={onPinFile} onScope={onScope} onImpact={onImpact}
          />
        </ul>
      )}
    </>
  );
}
