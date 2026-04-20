import type { ModelKey } from '../../lib/types';
import styles from './GraphFilterBar.module.css';

export interface GraphFilterState {
  models: Set<ModelKey>;        // empty = all
  roles: Set<string>;           // empty = all
}

interface Props {
  availableModels: ModelKey[];
  availableRoles: string[];
  filter: GraphFilterState;
  onChange: (next: GraphFilterState) => void;
}

function toggle<T>(set: Set<T>, item: T): Set<T> {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}

export function GraphFilterBar({ availableModels, availableRoles, filter, onChange }: Props) {
  const modelAll = filter.models.size === 0;
  const roleAll = filter.roles.size === 0;

  return (
    <div className={styles.bar}>
      <div className={styles.group}>
        <span className={styles.label}>Model</span>
        <button
          className={`${styles.chip} ${modelAll ? styles.active : ''}`}
          onClick={() => onChange({ ...filter, models: new Set() })}
          type="button"
        >
          all
        </button>
        {availableModels.map((m) => (
          <button
            key={m}
            className={`${styles.chip} ${filter.models.has(m) ? styles.active : ''}`}
            onClick={() => onChange({ ...filter, models: toggle(filter.models, m) })}
            type="button"
          >
            {m}
          </button>
        ))}
      </div>
      {availableRoles.length > 0 && (
        <div className={styles.group}>
          <span className={styles.label}>Role</span>
          <button
            className={`${styles.chip} ${roleAll ? styles.active : ''}`}
            onClick={() => onChange({ ...filter, roles: new Set() })}
            type="button"
          >
            all
          </button>
          {availableRoles.map((r) => (
            <button
              key={r}
              className={`${styles.chip} ${filter.roles.has(r) ? styles.active : ''}`}
              onClick={() => onChange({ ...filter, roles: toggle(filter.roles, r) })}
              type="button"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function matchesFilter(
  filter: GraphFilterState,
  modelKey: ModelKey,
  agentRole: string | null | undefined,
): boolean {
  if (filter.models.size > 0 && !filter.models.has(modelKey)) return false;
  if (filter.roles.size > 0) {
    if (!agentRole) return false;
    if (!filter.roles.has(agentRole)) return false;
  }
  return true;
}
