import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import styles from './WorkflowNodes.module.css';

export type WfNodeStatus = 'pending' | 'running' | 'done' | 'failed' | undefined;

export interface WfNodeData {
  label: string;
  description?: string;
  status?: WfNodeStatus;
  attempts?: number;
}

export type TaskNode = Node<WfNodeData, 'task'>;
export type AgentNode = Node<WfNodeData, 'agent'>;
export type DecisionNode = Node<WfNodeData, 'decision'>;

function WfNodeBase({
  data,
  selected,
  typeLabel,
  typeClass,
}: NodeProps<Node<WfNodeData>> & { typeLabel: string; typeClass: string }) {
  return (
    <div
      className={[
        styles.node,
        styles[typeClass],
        data.status ? styles[`status_${data.status}`] : '',
        selected ? styles.selected : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} />

      <span className={[styles.badge, styles[`badge_${typeClass}`]].join(' ')}>
        {typeLabel}
      </span>

      <div className={styles.label}>{data.label}</div>

      {data.description && (
        <div className={styles.description}>{data.description}</div>
      )}

      {data.status && (
        <div className={[styles.status, styles[`statusPill_${data.status}`]].join(' ')}>
          {data.status}
          {data.status === 'running' && <span className={styles.pulse} />}
        </div>
      )}

      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  );
}

export const TaskNodeComponent = memo((props: NodeProps<TaskNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="task" typeClass="task" />
));

export const AgentNodeComponent = memo((props: NodeProps<AgentNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="agent" typeClass="agent" />
));

export const DecisionNodeComponent = memo((props: NodeProps<DecisionNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="decision" typeClass="decision" />
));

TaskNodeComponent.displayName = 'TaskNode';
AgentNodeComponent.displayName = 'AgentNode';
DecisionNodeComponent.displayName = 'DecisionNode';

export const WF_NODE_TYPES = {
  task: TaskNodeComponent,
  agent: AgentNodeComponent,
  decision: DecisionNodeComponent,
};
