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

const AGENT_ROLE_COLOR: Record<string, string> = {
  explorer: '#3b82f6',
  implementer: '#16a34a',
  reviewer: '#f59e0b',
  orchestrator: '#a855f7',
};

function TurnNodeImpl({ data, selected }: NodeProps<Node<TurnNodeData, 'turn'>>) {
  const color = MODEL_COLOR[data.modelKey];
  const roleColor = data.agentRole ? AGENT_ROLE_COLOR[data.agentRole] : null;
  const tooltip = [
    `Turn ${data.label}`,
    `Model: ${data.modelKey}`,
    data.agentRole ? `Agent: ${data.agentRole}` : null,
    data.stopReason ? `Stop: ${data.stopReason}` : null,
    `Cache hit: ${data.cacheHitPct}%`,
    `In: ${data.inputTokens.toLocaleString()}`,
    `Out: ${data.outputTokens.toLocaleString()}`,
    `CacheRead: ${data.cacheReadTokens.toLocaleString()}`,
    data.costUsd > 0 ? `Cost: $${data.costUsd.toFixed(4)}` : null,
    typeof data.importance === 'number' ? `Weight: ${Math.round(data.importance * 100)}%` : null,
    data.hasErrors ? `Errors present` : null,
  ].filter(Boolean).join('\n');

  const classes = [
    styles.node,
    data.isSidechain ? styles.sidechain : '',
    data.hasErrors ? styles.errorGlow : '',
    selected ? styles.selected : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      style={{
        borderColor: color,
        borderLeft: roleColor ? `4px solid ${roleColor}` : undefined,
      }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Top} className={styles.handle} />
      <TurnNodeHeader
        label={data.label}
        modelKey={data.modelKey}
        stopReason={data.stopReason}
        costUsd={data.costUsd}
      />
      {data.agentRole && roleColor && (
        <div className={styles.roleRow} style={{ color: roleColor }} title={`Sub-agent: ${data.agentRole}`}>
          <span className={styles.roleLabel}>{data.agentRole}</span>
        </div>
      )}
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
