import { useState } from 'react';
import { Copy, Check, Maximize2 } from 'lucide-react';
import { Tooltip } from '../Tooltip/Tooltip';
import { Modal } from '../Modal/Modal';
import styles from './CopyableValue.module.css';

interface Props {
  value: string;
  maxChars?: number;
  mono?: boolean;
  expandable?: boolean;
  label?: string;
  className?: string;
}

export function CopyableValue({
  value,
  maxChars = 40,
  mono = false,
  expandable = false,
  label = 'Full value',
  className,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const truncated = value.length > maxChars;
  const display = truncated ? value.slice(0, maxChars) + '…' : value;

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  }

  const valueNode = (
    <span className={`${styles.value} ${mono ? styles.mono : ''}`}>{display}</span>
  );

  return (
    <>
      <span className={`${styles.wrap} ${className ?? ''}`}>
        {truncated ? (
          <Tooltip content={<span style={{ wordBreak: 'break-all' }}>{value}</span>}>
            {valueNode}
          </Tooltip>
        ) : (
          valueNode
        )}
        <button
          type="button"
          className={`${styles.btn} ${copied ? styles.ok : ''}`}
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy'}
          title={copied ? 'Copied!' : 'Copy'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        {expandable && (
          <button
            type="button"
            className={styles.btn}
            onClick={(e) => { e.stopPropagation(); setOpen(true); }}
            aria-label="Expand"
            title="View full"
          >
            <Maximize2 size={12} />
          </button>
        )}
      </span>
      {expandable && (
        <Modal open={open} onOpenChange={setOpen} title={label} size="lg">
          <pre className={styles.modalBody}>{value}</pre>
        </Modal>
      )}
    </>
  );
}
