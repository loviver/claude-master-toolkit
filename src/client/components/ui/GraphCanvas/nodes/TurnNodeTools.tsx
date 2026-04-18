import styles from '../GraphCanvas.module.css';

interface Props {
  tools: string[];
  max?: number;
}

export function TurnNodeTools({ tools, max = 3 }: Props) {
  if (!tools || tools.length === 0) return null;
  const shown = tools.slice(0, max);
  const rest = tools.length - shown.length;
  return (
    <div className={styles.tools} title={tools.join(', ')}>
      {shown.map((t) => (
        <span key={t} className={styles.tool}>{t}</span>
      ))}
      {rest > 0 && <span className={styles.tool}>+{rest}</span>}
    </div>
  );
}
