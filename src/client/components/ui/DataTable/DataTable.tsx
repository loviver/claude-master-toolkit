import { useMemo, useState, type ReactNode } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  sortBy?: (row: T) => number | string | null | undefined;
  width?: number | string;
  tooltip?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyFn: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  rowClassName?: (row: T) => string | undefined;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function DataTable<T>({
  columns,
  data,
  keyFn,
  onRowClick,
  emptyMessage = 'No data',
  defaultSort,
  rowClassName,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortBy) return data;
    const cmp = (a: T, b: T) => {
      const va = col.sortBy!(a);
      const vb = col.sortBy!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va).localeCompare(String(vb));
    };
    const arr = [...data].sort(cmp);
    return sort.dir === 'desc' ? arr.reverse() : arr;
  }, [data, sort, columns]);

  if (data.length === 0) {
    return <div className={styles.empty}>{emptyMessage}</div>;
  }

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = !!col.sortBy;
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  className={`${col.align === 'right' ? styles.right : ''} ${sortable ? styles.sortable : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={sortable ? () => toggleSort(col.key) : undefined}
                  title={col.tooltip}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.header}
                    {active && (sort!.dir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={keyFn(row)}
              className={`${onRowClick ? styles.clickable : ''} ${rowClassName?.(row) ?? ''}`}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col) => (
                <td key={col.key} className={col.align === 'right' ? styles.right : ''}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
