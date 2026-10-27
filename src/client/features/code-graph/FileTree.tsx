import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, Folder, FolderOpen } from 'lucide-react';
import { Input } from '../../components/ui';
import type { CodeGraphFileDTO } from '../../lib/types';
import { ancestorDirs, buildFileTree, matchFiles, type TreeDir } from './explorer-model';
import styles from './CodeGraph.module.css';

interface FileTreeProps {
  files: CodeGraphFileDTO[];
  changed: ReadonlySet<string>;
  activeFile: string | null;
  onOpenFile: (file: string) => void;
  /** Narrow the graph to a folder. */
  onScope: (dir: string) => void;
}

function DirRows({ dir, depth, expanded, toggle, activeFile, onOpenFile, onScope }: {
  dir: TreeDir;
  depth: number;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
} & Pick<FileTreeProps, 'activeFile' | 'onOpenFile' | 'onScope'>) {
  const pad = { paddingLeft: `calc(${depth} * var(--space-3) + var(--space-2))` };
  return (
    <>
      {dir.dirs.map((d) => {
        const open = expanded.has(d.path);
        return (
          <li key={d.path}>
            <div className={styles.treeRow} style={pad}>
              <button type="button" className={styles.treeItem} onClick={() => toggle(d.path)} aria-expanded={open} title={d.path}>
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {open ? <FolderOpen size={13} /> : <Folder size={13} />}
                <span className={styles.treeName}>{d.name}</span>
                {d.changed > 0 && <span className={styles.changeDot} title={`${d.changed} changed`} />}
              </button>
              <button
                type="button"
                className={styles.treeScope}
                onClick={() => onScope(d.path)}
                title={`Show only ${d.path} in the graph`}
              >
                {d.fileCount}
              </button>
            </div>
            {open && (
              <ul className={styles.treeList}>
                <DirRows
                  dir={d} depth={depth + 1} expanded={expanded} toggle={toggle}
                  activeFile={activeFile} onOpenFile={onOpenFile} onScope={onScope}
                />
              </ul>
            )}
          </li>
        );
      })}
      {dir.files.map((f) => (
        <li key={f.path}>
          <div className={styles.treeRow} style={pad}>
            <button
              type="button"
              className={styles.treeItem}
              aria-current={f.path === activeFile ? 'true' : undefined}
              onClick={() => onOpenFile(f.path)}
              title={f.path}
            >
              <span className={styles.treeIndent} />
              <FileCode size={13} />
              <span className={styles.treeName}>{f.name}</span>
              {f.changed && <span className={styles.changeDot} title="Changed" />}
            </button>
            {f.symbols > 0 && <span className={styles.treeCount}>{f.symbols}</span>}
          </div>
        </li>
      ))}
    </>
  );
}

export function FileTree({ files, changed, activeFile, onOpenFile, onScope }: FileTreeProps) {
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
    <div className={styles.tree}>
      <div className={styles.sidebarSearch}>
        <Input
          type="search"
          placeholder={`Filter ${files.length.toLocaleString()} files…`}
          aria-label="Filter files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) onOpenFile(matches[0].file); }}
        />
      </div>
      {query.trim() ? (
        <ul className={styles.treeList}>
          {matches.length === 0 && <li className={styles.muted}>No file matches</li>}
          {matches.map((f) => (
            <li key={f.file}>
              <button
                type="button"
                className={`${styles.treeItem} ${styles.treeMatch}`}
                aria-current={f.file === activeFile ? 'true' : undefined}
                onClick={() => onOpenFile(f.file)}
                title={f.file}
              >
                <FileCode size={13} />
                <span className={styles.treeName}>{f.file}</span>
                {changed.has(f.file) && <span className={styles.changeDot} title="Changed" />}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={styles.treeList}>
          <DirRows
            dir={tree} depth={0} expanded={expanded} toggle={toggle}
            activeFile={activeFile} onOpenFile={onOpenFile} onScope={onScope}
          />
        </ul>
      )}
    </div>
  );
}
