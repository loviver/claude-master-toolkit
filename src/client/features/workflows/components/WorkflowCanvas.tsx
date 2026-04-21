import { useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react';
import type { Node, Edge, Connection, OnSelectionChangeParams } from '@xyflow/react';
import type { WfNodeData } from '../nodes/WorkflowNodes.js';
import { WF_NODE_TYPES } from '../nodes/WorkflowNodes.js';

export interface WorkflowCanvasProps {
  initialNodes: Node<WfNodeData>[];
  initialEdges: Edge[];
  entrypoint: string;
  onChange: (nodes: Node<WfNodeData>[], edges: Edge[]) => void;
  onNodeSelect: (node: Node<WfNodeData> | null) => void;
}

function WorkflowCanvasInner({
  initialNodes,
  initialEdges,
  onChange,
  onNodeSelect,
}: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WfNodeData>>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const reactFlowInstance = useReactFlow();

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      // Use setTimeout to get the updated state after React applies changes
      setTimeout(() => {
        setNodes((nds) => {
          onChange(nds, edges);
          return nds;
        });
      }, 0);
    },
    [onNodesChange, setNodes, edges, onChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      setTimeout(() => {
        setEdges((eds) => {
          onChange(nodes, eds);
          return eds;
        });
      }, 0);
    },
    [onEdgesChange, setEdges, nodes, onChange],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const next = addEdge(connection, eds);
        onChange(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, onChange],
  );

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      onNodeSelect((selectedNodes[0] as Node<WfNodeData>) ?? null);
    },
    [onNodeSelect],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/workflow-node-type');
      if (!nodeType) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: Node<WfNodeData> = {
        id: crypto.randomUUID(),
        type: nodeType,
        position,
        data: { label: `New ${nodeType}`, status: undefined, isEntrypoint: false },
      };

      setNodes((nds) => {
        const next = [...nds, newNode];
        onChange(next, edges);
        return next;
      });
    },
    [reactFlowInstance, setNodes, edges, onChange],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={WF_NODE_TYPES}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChange}
        onDrop={onDrop}
        onDragOver={onDragOver}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="var(--border)" />
        <MiniMap pannable zoomable />
        <Controls />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
