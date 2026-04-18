import { Calendar, FolderOpen, Cpu } from 'lucide-react';
import { Icon } from '../Icon/Icon';
import { useFilters } from '../../../lib/filters';
import type { FilterState } from '../../../lib/filters';
import styles from './FilterBar.module.css';

const RANGES: Array<{ value: FilterState['dateRange']; label: string }> = [
  { value: '1d', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

const MODELS: Array<{ value: FilterState['model']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

interface FilterBarProps {
  projects?: Array<{ projectPath: string; projectName: string }>;
  showProject?: boolean;
  showModel?: boolean;
  showRange?: boolean;
}

export function FilterBar({ projects = [], showProject = true, showModel = true, showRange = true }: FilterBarProps) {
  const { filters, setFilter } = useFilters();

  return (
    <div className={styles.bar}>
      {showRange && (
        <div className={styles.group}>
          <Icon icon={Calendar} size="sm" tone="muted" />
          <div className={styles.segmented}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                className={`${styles.segment} ${filters.dateRange === r.value ? styles.active : ''}`}
                onClick={() => setFilter('dateRange', r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showProject && projects.length > 0 && (
        <div className={styles.group}>
          <Icon icon={FolderOpen} size="sm" tone="muted" />
          <select
            className={styles.select}
            value={filters.project ?? ''}
            onChange={(e) => setFilter('project', e.target.value || undefined)}
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.projectPath} value={p.projectPath}>{p.projectName}</option>
            ))}
          </select>
        </div>
      )}

      {showModel && (
        <div className={styles.group}>
          <Icon icon={Cpu} size="sm" tone="muted" />
          <div className={styles.segmented}>
            {MODELS.map((m) => (
              <button
                key={m.value}
                className={`${styles.segment} ${filters.model === m.value ? styles.active : ''}`}
                onClick={() => setFilter('model', m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
