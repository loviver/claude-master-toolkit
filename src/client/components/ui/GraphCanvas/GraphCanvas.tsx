import { useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, MiniMap } from '@xyflow/react';
import type { Node, Edge, ReactFlowInstance } from '@xyflow/react';
import { MODEL_COLOR } from '../../../lib/model-colors';
import { nodeTypes } from './lib/nodeTypes';
import type { GraphNodeData } from './types';
import styles from './GraphCanvas.module.css';

interface GraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodeClick?: (id: string, data: GraphNodeData) => void;
  height?: number;
  focusId?: string | null;
  /** Frame only these nodes on first paint; fitting a long session whole makes every node unreadable. */
  initialFitIds?: string[];
}

export function GraphCanvas({ nodes, edges, onNodeClick, height = 600, focusId, initialFitIds }: GraphCanvasProps) {
  const instanceRef = useRef<ReactFlowInstance | null>(null);

  useEffect(() => {
    if (!focusId || !instanceRef.current) return;
    const target = instanceRef.current.getNode(focusId);
    if (!target) return;
    instanceRef.current.fitView({
      nodes: [{ id: focusId }],
      duration: 300,
      padding: 0.4,
      maxZoom: 1.1,
    });
  }, [focusId]);

  return (
    <div className={styles.canvas} style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={
          initialFitIds
            ? { nodes: initialFitIds.map((id) => ({ id })), padding: 0.15, maxZoom: 1, duration: 0 }
            : { padding: 0.2, duration: 0 }
        }
        onlyRenderVisibleElements
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        onInit={(inst) => { instanceRef.current = inst; }}
        onNodeClick={(_, n) => onNodeClick?.(n.id, n.data as GraphNodeData)}
      >
        <Background gap={20} color="var(--border)" />
        <MiniMap
          className={styles.minimap}
          nodeColor={(n) => {
            const data = n.data as GraphNodeData;
            return MODEL_COLOR[data?.modelKey ?? 'unknown'];
          }}
          bgColor="var(--bg-surface)"
          maskColor="color-mix(in srgb, var(--bg-page) 70%, transparent)"
          maskStrokeColor="var(--border-strong)"
          pannable
          zoomable
        />
        <Controls showInteractive={false} className={styles.controls} />
      </ReactFlow>
    </div>
  );
}
