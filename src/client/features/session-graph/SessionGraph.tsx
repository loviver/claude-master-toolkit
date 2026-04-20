import { useCallback, useMemo, useState } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { Network } from 'lucide-react';
import { useSessionGraphLive } from '../../hooks/queries/useSessions';
import { Card, CardContent, EmptyState, Skeleton, GraphCanvas, Button } from '../../components/ui';
import type { SessionGraph as SessionGraphType, SessionGraphNode } from '../../lib/types';
import type { GraphNodeData, TurnNodeData, ClusterNodeData } from '../../components/ui/GraphCanvas/types';
import { clusterTurns, type GraphItem } from './clustering';
import { TurnPreviewDrawer } from './TurnPreviewDrawer';
import { GraphLegend } from './GraphLegend';
import { GraphFilterBar, matchesFilter, type GraphFilterState } from './GraphFilterBar';
import { computeNodeWeights, weightToWidth, MAX_NODE_W } from './node-weight';
import type { ModelKey } from '../../../shared/api-types';
import styles from './SessionGraph.module.css';

interface Props {
  sessionId: string;
}

const NODE_W = MAX_NODE_W;
const NODE_H = 140;
const X_GAP = 40;
const Y_GAP = 56;

function turnToData(n: SessionGraphNode, importance: number): TurnNodeData {
  const toolsErr = n.toolsErrorCount ?? 0;
  return {
    kind: 'turn',
    turnId: n.id,
    label: `Turn ${n.turnIdx + 1}`,
    modelKey: n.modelKey,
    phase: n.phase,
    isSidechain: n.isSidechain,
    tools: n.tools,
    stopReason: n.stopReason ?? null,
    inputTokens: n.inputTokens,
    outputTokens: n.outputTokens,
    cacheReadTokens: n.cacheReadTokens,
    cacheCreationTokens: n.cacheCreationTokens,
    cacheHitPct: n.cacheHitPct,
    costUsd: n.costUsd,
    durationMs: n.durationMs ?? null,
    isApiError: !!n.isApiError,
    apiErrorStatus: n.apiErrorStatus ?? null,
    hasThinking: !!n.hasThinking,
    iterationsCount: n.iterationsCount ?? 0,
    webSearchCount: n.webSearchCount ?? 0,
    webFetchCount: n.webFetchCount ?? 0,
    hooksCount: n.hooksCount ?? 0,
    filesChangedCount: n.filesChangedCount ?? 0,
    permissionMode: n.permissionMode ?? null,
    slug: n.slug ?? null,
    requestId: n.requestId ?? null,
    isMeta: !!n.isMeta,
    isCompactSummary: !!n.isCompactSummary,
    toolsErrorCount: toolsErr,
    cwd: n.cwd ?? null,
    gitBranch: n.gitBranch ?? null,
    agentRole: n.agentRole ?? null,
    importance,
    hasErrors: toolsErr > 0 || !!n.isApiError,
  };
}

function clusterToData(item: Extract<GraphItem, { kind: 'cluster' }>): ClusterNodeData {
  const first = item.turns[0];
  return {
    kind: 'cluster',
    clusterId: item.id,
    label: first.phase !== 'unknown' ? capitalize(first.phase) : 'Run',
    modelKey: first.modelKey,
    phase: first.phase,
    tools: first.tools,
    turnCount: item.turns.length,
    totalTokens: item.stats.totalTokens,
    totalCost: item.stats.totalCost,
    avgCacheHitPct: item.stats.avgCacheHitPct,
    firstTurnIdx: item.stats.firstTurnIdx,
    lastTurnIdx: item.stats.lastTurnIdx,
  };
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

interface LayoutItem {
  id: string;
  kind: 'turn' | 'cluster';
  data: GraphNodeData;
  parentInChain: string | null;
}

function buildLayout(
  items: GraphItem[],
  graph: SessionGraphType,
): { nodes: Node[]; edges: Edge[]; containerOf: Map<string, string> } {
  // Map original turn id -> its containing item id (cluster OR turn itself)
  const containerOf = new Map<string, string>();
  const layoutItems: LayoutItem[] = [];
  const weights = computeNodeWeights(graph.nodes);
  for (const it of items) {
    if (it.kind === 'turn') {
      containerOf.set(it.node.id, it.node.id);
      layoutItems.push({
        id: it.node.id,
        kind: 'turn',
        data: turnToData(it.node, weights.get(it.node.id) ?? 0.5),
        parentInChain: null,
      });
    } else {
      it.turns.forEach((t) => containerOf.set(t.id, it.id));
      layoutItems.push({
        id: it.id,
        kind: 'cluster',
        data: clusterToData(it),
        parentInChain: null,
      });
    }
  }

  // Chain parent = container of previous turn in timeline
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (let i = 0; i < layoutItems.length; i++) {
    const cur = layoutItems[i];
    if (i === 0) continue;
    const prev = layoutItems[i - 1];
    cur.parentInChain = prev.id;
  }

  // Simple tree layout based on parentInChain (flat chain + sidechain branches)
  const childrenByParent = new Map<string, string[]>();
  const roots: string[] = [];
  for (const it of layoutItems) {
    // Resolve real parent via container mapping for sidechain edges
    const originalParent =
      it.kind === 'turn' ? byId.get(it.id)?.parentId ?? null : null;
    const mappedParent = originalParent ? containerOf.get(originalParent) ?? null : null;
    const parent = mappedParent && mappedParent !== it.id ? mappedParent : it.parentInChain;
    if (!parent) {
      roots.push(it.id);
    } else {
      const arr = childrenByParent.get(parent) ?? [];
      arr.push(it.id);
      childrenByParent.set(parent, arr);
    }
  }

  const positions = new Map<string, { x: number; y: number }>();
  let cursorY = 0;
  const walk = (id: string, depth: number): void => {
    const children = childrenByParent.get(id) ?? [];
    if (children.length === 0) {
      positions.set(id, { x: depth * (NODE_W + X_GAP), y: cursorY * (NODE_H + Y_GAP) });
      cursorY += 1;
      return;
    }
    const startY = cursorY;
    for (const c of children) walk(c, depth + 1);
    const endY = cursorY - 1;
    const midY = Math.floor((startY + endY) / 2);
    positions.set(id, { x: depth * (NODE_W + X_GAP), y: midY * (NODE_H + Y_GAP) });
  };
  for (const r of roots) walk(r, 0);

  const nodes: Node[] = layoutItems.map((it) => {
    const w = it.kind === 'turn' ? weightToWidth((it.data as TurnNodeData).importance ?? 0.5) : NODE_W;
    return {
      id: it.id,
      type: it.kind === 'cluster' ? 'cluster' : 'turn',
      position: positions.get(it.id) ?? { x: 0, y: 0 },
      data: it.data,
      style: { width: w },
    };
  });

  const edges: Edge[] = [];
  for (let i = 1; i < layoutItems.length; i++) {
    const from = layoutItems[i - 1].id;
    const to = layoutItems[i].id;
    const targetData = layoutItems[i].data;
    const toIsSidechain =
      layoutItems[i].kind === 'turn' && (targetData as TurnNodeData).isSidechain;
    const targetImportance =
      layoutItems[i].kind === 'turn' ? (targetData as TurnNodeData).importance ?? 0.5 : 0.5;
    const targetHasErrors =
      layoutItems[i].kind === 'turn' && !!(targetData as TurnNodeData).hasErrors;
    edges.push({
      id: `${from}-${to}`,
      source: from,
      target: to,
      animated: !!toIsSidechain,
      style: {
        stroke: targetHasErrors
          ? 'var(--color-danger, #ef4444)'
          : toIsSidechain
            ? 'var(--text-muted)'
            : 'var(--border-strong)',
        strokeDasharray: toIsSidechain ? '4 4' : undefined,
        strokeWidth: 1 + targetImportance * 2,
      },
    });
  }

  // Delegation overlay: parent→child edges (real lineage via parentId),
  // skipped when they duplicate the timeline predecessor.
  const timelineParentOf = new Map<string, string>();
  for (let i = 1; i < layoutItems.length; i++) {
    timelineParentOf.set(layoutItems[i].id, layoutItems[i - 1].id);
  }
  const seen = new Set<string>();
  for (const n of graph.nodes) {
    if (!n.parentId) continue;
    const childContainer = containerOf.get(n.id);
    const parentContainer = containerOf.get(n.parentId);
    if (!childContainer || !parentContainer) continue;
    if (childContainer === parentContainer) continue;
    if (timelineParentOf.get(childContainer) === parentContainer) continue;
    const key = `${parentContainer}->${childContainer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: `delegation-${key}`,
      source: parentContainer,
      target: childContainer,
      type: 'smoothstep',
      animated: true,
      label: 'delegates',
      labelStyle: { fontSize: 9, fontFamily: 'var(--font-mono)', fill: '#a855f7' },
      labelBgStyle: { fill: 'var(--bg-surface)' },
      labelBgPadding: [3, 2],
      style: {
        stroke: '#a855f7',
        strokeWidth: 1.5,
        strokeDasharray: '2 4',
        opacity: 0.85,
      },
    });
  }

  return { nodes, edges, containerOf };
}

export function SessionGraph({ sessionId }: Props) {
  const { data, isLoading } = useSessionGraphLive(sessionId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [clusteringOn, setClusteringOn] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<GraphFilterState>(() => ({ models: new Set(), roles: new Set() }));

  const { availableModels, availableRoles } = useMemo(() => {
    const m = new Set<ModelKey>();
    const r = new Set<string>();
    for (const n of data?.nodes ?? []) {
      m.add(n.modelKey);
      if (n.agentRole) r.add(n.agentRole);
    }
    return { availableModels: Array.from(m), availableRoles: Array.from(r) };
  }, [data]);

  const items = useMemo<GraphItem[]>(() => {
    if (!data) return [];
    return clusterTurns(data.nodes, expanded, clusteringOn);
  }, [data, expanded, clusteringOn]);

  const positioned = useMemo(
    () => (data ? buildLayout(items, data) : { nodes: [], edges: [], containerOf: new Map<string, string>() }),
    [items, data],
  );

  const focusId = selectedId ? positioned.containerOf.get(selectedId) ?? selectedId : null;

  const nodesWithSelection = useMemo(() => {
    const filterActive = filter.models.size > 0 || filter.roles.size > 0;
    return positioned.nodes.map((n) => {
      const d = n.data as GraphNodeData;
      const role = d.kind === 'turn' ? (d as TurnNodeData).agentRole ?? null : null;
      const match = filterActive
        ? matchesFilter(filter, (d as TurnNodeData).modelKey, role)
        : true;
      const selected = n.id === focusId;
      const style = {
        ...(n.style ?? {}),
        opacity: match ? 1 : 0.18,
        pointerEvents: match ? 'auto' : 'none',
      } as React.CSSProperties;
      return { ...n, selected, style };
    });
  }, [positioned.nodes, focusId, filter]);

  const clusterCount = items.filter((i) => i.kind === 'cluster').length;
  const collapsedTurns =
    items.reduce((s, i) => s + (i.kind === 'cluster' ? i.turns.length : 0), 0);

  const handleNodeClick = useCallback(
    (id: string, nodeData: GraphNodeData) => {
      if (nodeData.kind === 'cluster') {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      } else {
        setSelectedId(id);
        setDrawerOpen(true);
      }
    },
    [],
  );

  const flatTurns = data?.nodes ?? [];

  if (isLoading) return <Skeleton height={600} radius="md" />;
  if (!data || data.nodes.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState icon={Network} title="No graph data" description="This session has no recorded turns" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarLabel}>
          {data.nodes.length} turns · {clusterCount} cluster{clusterCount === 1 ? '' : 's'}
          {clusterCount > 0 && ` (${collapsedTurns} collapsed)`}
        </span>
        <div className={styles.toolbarActions}>
          {expanded.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}>
              Re-collapse all
            </Button>
          )}
          <Button
            size="sm"
            variant={clusteringOn ? 'default' : 'ghost'}
            onClick={() => setClusteringOn((v) => !v)}
          >
            Clusters: {clusteringOn ? 'on' : 'off'}
          </Button>
        </div>
      </div>
      <GraphFilterBar
        availableModels={availableModels}
        availableRoles={availableRoles}
        filter={filter}
        onChange={setFilter}
      />
      <div className={styles.canvasWrap}>
        <GraphCanvas
          nodes={nodesWithSelection}
          edges={positioned.edges}
          height={640}
          onNodeClick={handleNodeClick}
          focusId={focusId}
        />
        <GraphLegend />
      </div>
      <TurnPreviewDrawer
        sessionId={sessionId}
        turns={flatTurns}
        selectedId={selectedId}
        open={drawerOpen}
        onSelect={(id) => { setSelectedId(id); }}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
