import type { NodeTypes } from '@xyflow/react';
import { TurnNode } from '../nodes/TurnNode';
import { ClusterNode } from '../nodes/ClusterNode';

export const nodeTypes: NodeTypes = {
  turn: TurnNode,
  cluster: ClusterNode,
};
