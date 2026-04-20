import { useMemo, useState } from 'react';
import { Copy, Check, Maximize2, WrapText, Braces, FileText } from 'lucide-react';
import { Modal } from '../Modal/Modal';
import { JsonTree } from './JsonTree';
import styles from './ExpandablePre.module.css';

interface Props {
  content: string;
  lang?: 'json' | 'text' | 'auto';
  collapseAt?: number;
  title?: string;
  className?: string;
}

export function ExpandablePre({
  content,
  lang = 'auto',
  collapseAt = 2000,
  title = 'Content',
  className,
}: Props) {
  const detectedJson = useMemo(() => {
    if (lang === 'text') return null;
    const trimmed = content.trim();
    if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
    try { return JSON.parse(trimmed); } catch { return null; }
  }, [content, lang]);

  const isJson = detectedJson !== null && (lang === 'json' || lang === 'auto');
  const [asJson, setAsJson] = useState(isJson);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(false);

  const tooLong = content.length > collapseAt;
  const showBody = !tooLong || expanded;

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* no-op */ }
  }

  const formattedText = useMemo(() => {
    if (isJson && asJson && detectedJson !== null) {
      try { return JSON.stringify(detectedJson, null, 2); } catch { return content; }
    }
    return content;
  }, [isJson, asJson, detectedJson, content]);

  return (
    <>
      <div className={`${styles.root} ${className ?? ''}`}>
        <div className={styles.bar}>
          <span className={styles.count}>{content.length.toLocaleString()} chars</span>
          {isJson && (
            <button
              type="button"
              className={`${styles.btn} ${asJson ? styles.btnActive : ''}`}
              onClick={() => setAsJson((v) => !v)}
              title={asJson ? 'Show as raw' : 'Show as JSON tree'}
            >
              {asJson ? <Braces size={11} /> : <FileText size={11} />}
              {asJson ? 'tree' : 'raw'}
            </button>
          )}
          {!asJson && (
            <button
              type="button"
              className={`${styles.btn} ${wrap ? styles.btnActive : ''}`}
              onClick={() => setWrap((v) => !v)}
              title={wrap ? 'No wrap' : 'Wrap'}
            >
              <WrapText size={11} />
            </button>
          )}
          <button
            type="button"
            className={`${styles.btn} ${copied ? styles.ok : ''}`}
            onClick={copy}
            title={copied ? 'Copied!' : 'Copy'}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => setFull(true)}
            title="Fullscreen"
          >
            <Maximize2 size={11} />
          </button>
        </div>

        {showBody ? (
          asJson && detectedJson !== null ? (
            <div className={styles.tree}>
              <JsonTree data={detectedJson} defaultOpen />
            </div>
          ) : (
            <pre className={`${styles.pre} ${wrap ? '' : styles.preNoWrap}`}>{formattedText}</pre>
          )
        ) : null}

        {tooLong && !expanded && (
          <button type="button" className={styles.collapseHint} onClick={() => setExpanded(true)}>
            … {(content.length - Math.min(collapseAt, content.length)).toLocaleString()} chars más — click to expand
          </button>
        )}
        {tooLong && expanded && (
          <button type="button" className={styles.collapseHint} onClick={() => setExpanded(false)}>
            collapse
          </button>
        )}
      </div>

      <Modal open={full} onOpenChange={setFull} title={title} description={`${content.length.toLocaleString()} chars`} size="lg">
        {asJson && detectedJson !== null ? (
          <div className={styles.modalTree}>
            <JsonTree data={detectedJson} defaultOpen />
          </div>
        ) : (
          <pre className={styles.modalPre}>{formattedText}</pre>
        )}
      </Modal>
    </>
  );
}
