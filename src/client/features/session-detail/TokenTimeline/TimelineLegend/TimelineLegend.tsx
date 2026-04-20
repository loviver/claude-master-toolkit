import { colorForModel } from '../../../../lib/model-colors';
import { shortModel } from '../../../../lib/format';
import styles from './TimelineLegend.module.css';

interface TimelineLegendProps {
  models: string[];
}

export function TimelineLegend({ models }: TimelineLegendProps) {
  return (
    <div className={styles.legend}>
      {models.map((m) => (
        <span key={m} className={styles.chip}>
          <span className={styles.dot} style={{ background: colorForModel(m) }} />
          {shortModel(m)}
        </span>
      ))}
    </div>
  );
}
