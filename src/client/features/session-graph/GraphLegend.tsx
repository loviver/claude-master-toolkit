import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from './GraphLegend.module.css';

const ROLE_COLORS: Array<{ role: string; color: string }> = [
  { role: 'explorer', color: '#3b82f6' },
  { role: 'implementer', color: '#16a34a' },
  { role: 'reviewer', color: '#f59e0b' },
  { role: 'orchestrator', color: '#a855f7' },
];

export function GraphLegend() {
  const [open, setOpen] = useState(true);

  return (
    <div className={styles.legend} aria-label="Graph legend">
      <button
        type="button"
        className={styles.header}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Legend</span>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className={styles.body}>
          <section>
            <h4>Node width</h4>
            <div className={styles.widthRow}>
              <span className={styles.widthSm} />
              <span className={styles.widthMd} />
              <span className={styles.widthLg} />
              <span className={styles.caption}>low → high impact (tokens + tools + cost)</span>
            </div>
          </section>

          <section>
            <h4>Left accent = sub-agent role</h4>
            <ul className={styles.roleList}>
              {ROLE_COLORS.map(({ role, color }) => (
                <li key={role}>
                  <span className={styles.roleDot} style={{ background: color }} />
                  <span>{role}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4>Visual cues</h4>
            <ul className={styles.cueList}>
              <li>
                <span className={styles.cueDashed} />
                <span>sidechain (branch)</span>
              </li>
              <li>
                <span className={styles.cueGlow} />
                <span>has errors (tool/API)</span>
              </li>
              <li>
                <span className={styles.cueEdge} />
                <span>edge weight ∝ turn importance</span>
              </li>
              <li>
                <span className={styles.cueEdgeError} />
                <span>edge red ⇒ target has errors</span>
              </li>
              <li>
                <span className={styles.cueEdgeDelegate} />
                <span>delegation (parent → sub-agent)</span>
              </li>
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
