import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import styles from './WorkflowNodes.module.css';

export type WfNodeStatus = 'pending' | 'running' | 'done' | 'failed' | undefined;

export interface WfNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  status?: WfNodeStatus;
  attempts?: number;
  isEntrypoint?: boolean;
  config?: Record<string, unknown>;
}

export type TaskNode = Node<WfNodeData, 'task'>;
export type AgentNode = Node<WfNodeData, 'agent'>;
export type DecisionNode = Node<WfNodeData, 'decision'>;
export type SkillNode = Node<WfNodeData, 'skill'>;
export type BashNode = Node<WfNodeData, 'bash'>;
export type ReadNode = Node<WfNodeData, 'read'>;
export type EditNode = Node<WfNodeData, 'edit'>;
export type SubflowNode = Node<WfNodeData, 'subflow'>;
export type ParallelNode = Node<WfNodeData, 'parallel'>;

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

      {data.isEntrypoint && (
        <div className={styles.entrypoint}>&#9654; start</div>
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

export const SkillNodeComponent = memo((props: NodeProps<SkillNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="skill" typeClass="skill" />
));
export const BashNodeComponent = memo((props: NodeProps<BashNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="bash" typeClass="bash" />
));
export const ReadNodeComponent = memo((props: NodeProps<ReadNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="read" typeClass="read" />
));
export const EditNodeComponent = memo((props: NodeProps<EditNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="edit" typeClass="edit" />
));
export const SubflowNodeComponent = memo((props: NodeProps<SubflowNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="subflow" typeClass="subflow" />
));
export const ParallelNodeComponent = memo((props: NodeProps<ParallelNode>) => (
  <WfNodeBase {...(props as any)} typeLabel="parallel" typeClass="parallel" />
));

TaskNodeComponent.displayName = 'TaskNode';
AgentNodeComponent.displayName = 'AgentNode';
DecisionNodeComponent.displayName = 'DecisionNode';
SkillNodeComponent.displayName = 'SkillNode';
BashNodeComponent.displayName = 'BashNode';
ReadNodeComponent.displayName = 'ReadNode';
EditNodeComponent.displayName = 'EditNode';
SubflowNodeComponent.displayName = 'SubflowNode';
ParallelNodeComponent.displayName = 'ParallelNode';

export const WF_NODE_TYPES = {
  task: TaskNodeComponent,
  agent: AgentNodeComponent,
  decision: DecisionNodeComponent,
  skill: SkillNodeComponent,
  bash: BashNodeComponent,
  read: ReadNodeComponent,
  edit: EditNodeComponent,
  subflow: SubflowNodeComponent,
  parallel: ParallelNodeComponent,
};
