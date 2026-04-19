import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { MODEL_COLOR } from '../../../../lib/model-colors';
import type { TurnNodeData } from '../types';
import { TurnNodeHeader } from './TurnNodeHeader';
import { TurnNodeTokens } from './TurnNodeTokens';
import { TurnNodeTools } from './TurnNodeTools';
import { TurnNodeCache } from './TurnNodeCache';
import { TurnNodePhase } from './TurnNodePhase';
import { TurnNodeDuration } from './TurnNodeDuration';
import { TurnNodeMiniBadges } from './TurnNodeMiniBadges';
import styles from '../GraphCanvas.module.css';

function TurnNodeImpl({ data, selected }: NodeProps<Node<TurnNodeData, 'turn'>>) {
  const color = MODEL_COLOR[data.modelKey];
  const tooltip = [
    `Turn ${data.label}`,
    `Model: ${data.modelKey}`,
    data.stopReason ? `Stop: ${data.stopReason}` : null,
    `Cache hit: ${data.cacheHitPct}%`,
    `In: ${data.inputTokens.toLocaleString()}`,
    `Out: ${data.outputTokens.toLocaleString()}`,
    `CacheRead: ${data.cacheReadTokens.toLocaleString()}`,
    data.costUsd > 0 ? `Cost: $${data.costUsd.toFixed(4)}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div
      className={`${styles.node} ${data.isSidechain ? styles.sidechain : ''} ${selected ? styles.selected : ''}`}
      style={{ borderColor: color }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <TurnNodeHeader
        label={data.label}
        modelKey={data.modelKey}
        stopReason={data.stopReason}
        costUsd={data.costUsd}
      />
      <TurnNodeTokens
        input={data.inputTokens}
        output={data.outputTokens}
        cacheRead={data.cacheReadTokens}
      />
      <TurnNodeTools tools={data.tools} />
      <TurnNodeCache pct={data.cacheHitPct} />
      <TurnNodeMiniBadges
        hasThinking={data.hasThinking}
        iterationsCount={data.iterationsCount}
        webSearchCount={data.webSearchCount}
        webFetchCount={data.webFetchCount}
        hooksCount={data.hooksCount}
        filesChangedCount={data.filesChangedCount}
        isApiError={data.isApiError}
        apiErrorStatus={data.apiErrorStatus}
        toolsErrorCount={data.toolsErrorCount}
        isMeta={data.isMeta}
        isCompactSummary={data.isCompactSummary}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
        <TurnNodePhase phase={data.phase} stopReason={data.stopReason} />
        <TurnNodeDuration durationMs={data.durationMs} />
      </div>
      <Handle type="source" position={Position.Bottom} className={styles.handle} />
    </div>
  );
}

export const TurnNode = memo(TurnNodeImpl);
