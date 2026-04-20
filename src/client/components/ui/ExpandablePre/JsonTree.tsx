import styles from './JsonTree.module.css';

interface Props {
  data: unknown;
  name?: string;
  depth?: number;
  defaultOpen?: boolean;
}

export function JsonTree({ data, name, depth = 0, defaultOpen }: Props) {
  const open = defaultOpen ?? depth < 2;

  if (data === null) return <Leaf name={name} value="null" kind="null" />;
  if (typeof data === 'string') return <Leaf name={name} value={`"${data}"`} kind="string" />;
  if (typeof data === 'number') return <Leaf name={name} value={String(data)} kind="number" />;
  if (typeof data === 'boolean') return <Leaf name={name} value={String(data)} kind="boolean" />;

  if (Array.isArray(data)) {
    if (data.length === 0) return <Leaf name={name} value="[]" kind="empty" />;
    return (
      <details open={open} className={styles.node}>
        <summary className={styles.summary}>
          {name && <span className={styles.key}>{name}: </span>}
          <span className={styles.bracket}>[</span>
          <span className={styles.count}>{data.length}</span>
          <span className={styles.bracket}>]</span>
        </summary>
        <div className={styles.children}>
          {data.map((v, i) => (
            <JsonTree key={i} data={v} name={String(i)} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <Leaf name={name} value="{}" kind="empty" />;
    return (
      <details open={open} className={styles.node}>
        <summary className={styles.summary}>
          {name && <span className={styles.key}>{name}: </span>}
          <span className={styles.bracket}>{'{'}</span>
          <span className={styles.count}>{entries.length}</span>
          <span className={styles.bracket}>{'}'}</span>
        </summary>
        <div className={styles.children}>
          {entries.map(([k, v]) => (
            <JsonTree key={k} data={v} name={k} depth={depth + 1} />
          ))}
        </div>
      </details>
    );
  }

  return <Leaf name={name} value={String(data)} kind="string" />;
}

function Leaf({ name, value, kind }: { name?: string; value: string; kind: string }) {
  return (
    <div className={styles.leaf}>
      {name && <span className={styles.key}>{name}: </span>}
      <span className={styles[kind] ?? ''}>{value}</span>
    </div>
  );
}
