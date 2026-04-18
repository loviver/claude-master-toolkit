import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { MODEL_COLOR, PHASE_COLOR } from '../../../../lib/model-colors';
import type { ClusterNodeData } from '../types';
import { formatCost, formatTokens } from '../lib/formatters';
import styles from '../GraphCanvas.module.css';

function ClusterNodeImpl({ data, selected }: NodeProps<Node<ClusterNodeData, 'cluster'>>) {
  const color = MODEL_COLOR[data.modelKey];
  const phaseColor = data.phase !== 'unknown' ? PHASE_COLOR[data.phase] : 'var(--text-muted)';
  const tooltip = [
    `${data.label} (${data.turnCount} turns)`,
    `Tools: ${data.tools.join(', ') || '—'}`,
    `Tokens: ${data.totalTokens.toLocaleString()}`,
    `Cost: ${formatCost(data.totalCost) || '—'}`,
    `Cache avg: ${data.avgCacheHitPct}%`,
    `Turns ${data.firstTurnIdx + 1}–${data.lastTurnIdx + 1}`,
    'Click to expand',
  ].join('\n');

  return (
    <div
      className={`${styles.node} ${styles.cluster} ${selected ? styles.selected : ''}`}
      style={{ borderColor: color }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <div className={styles.nodeHeader}>
        <span className={styles.dot} style={{ background: color }} />
        <span className={styles.nodeLabel}>{data.label}</span>
        <span className={styles.clusterCount}>×{data.turnCount}</span>
      </div>
      <div className={styles.tokens}>
        <span className={styles.tokenCache}>Σ {formatTokens(data.totalTokens)}</span>
        {data.totalCost > 0 && <span className={styles.cost}>{formatCost(data.totalCost)}</span>}
        <span className={styles.cacheLabel}>{data.avgCacheHitPct}% cache</span>
      </div>
      {data.tools.length > 0 && (
        <div className={styles.tools} title={data.tools.join(', ')}>
          {data.tools.slice(0, 3).map((t) => (
            <span key={t} className={styles.tool}>{t}</span>
          ))}
          {data.tools.length > 3 && <span className={styles.tool}>+{data.tools.length - 3}</span>}
        </div>
      )}
      <div className={styles.phase} style={{ color: phaseColor }}>{data.phase}</div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeImpl);
