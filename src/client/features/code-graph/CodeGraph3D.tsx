import { useEffect, useRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import {
  CANVAS_BG,
  KIND_COLORS,
  LINK_COLORS,
  STATE_COLORS,
  escapeHtml,
  kindCategory,
  linkEnds,
  nodeVal,
  type Neighbours,
  type RenderGraph,
  type RenderLink,
  type RenderNode,
} from './graph-model';
import styles from './CodeGraph.module.css';

type Engine = ForceGraph3DInstance<RenderNode, RenderLink>;

export interface CodeGraphOverlay {
  touched: ReadonlySet<string>;
  blast: ReadonlySet<string>;
  /** Ids reindexed recently, rendered as "hot". */
  hot: ReadonlySet<string>;
}

interface CodeGraph3DProps {
  graph: RenderGraph;
  adjacency: Map<string, Neighbours>;
  selectedId: string | null;
  overlay: CodeGraphOverlay;
  /** Fly the camera to this node; `nonce` lets the same id be requested twice. */
  flyTo: { id: string; nonce: number } | null;
  /** Identity of the current view; changing it reframes the camera once the layout settles. */
  fitKey: string;
  onSelect: (id: string | null) => void;
}

/** Above these sizes per-object detail costs more frame time than it adds meaning. */
const DETAILED_NODES = 1500;
const ARROW_LINKS = 4000;
const FLY_DISTANCE = 140;
const FLY_MS = 1200;
const FIT_MS = 600;
const FIT_PADDING = 40;

interface VisualState {
  selectedId: string | null;
  adjacency: Map<string, Neighbours>;
  overlay: CodeGraphOverlay;
}

function isNeighbour(state: VisualState, id: string): boolean {
  if (!state.selectedId) return true;
  if (id === state.selectedId) return true;
  const n = state.adjacency.get(state.selectedId);
  return !!n && (n.callers.has(id) || n.deps.has(id));
}

function nodeColor(node: RenderNode, state: VisualState): string {
  if (node.id === state.selectedId) return STATE_COLORS.selected;
  if (!isNeighbour(state, node.id)) return STATE_COLORS.dim;
  if (state.overlay.touched.has(node.id)) return STATE_COLORS.touched;
  if (state.overlay.blast.has(node.id)) return STATE_COLORS.blast;
  if (state.overlay.hot.has(node.id)) return STATE_COLORS.hot;
  return KIND_COLORS[kindCategory(node.kind)];
}

function linkTouchesSelection(link: RenderLink, state: VisualState): boolean {
  const [s, t] = linkEnds(link);
  return s === state.selectedId || t === state.selectedId;
}

function nodeTooltip(node: RenderNode): string {
  const where = node.file && node.kind !== 'file' ? `<br/><span>${escapeHtml(node.file)}</span>` : '';
  return `<div class="${styles.tooltip}"><b>${escapeHtml(node.label)}</b> · ${escapeHtml(node.kind)}${where}</div>`;
}

export function CodeGraph3D({ graph, adjacency, selectedId, overlay, flyTo, fitKey, onSelect }: CodeGraph3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // Accessors read through refs so selection/overlay changes recolor without rebuilding the scene.
  const stateRef = useRef<VisualState>({ selectedId, adjacency, overlay });
  stateRef.current = { selectedId, adjacency, overlay };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fitPendingRef = useRef(true);

  // Mount the engine once per component lifetime.
  useEffect(() => {
    const host = hostRef.current!;
    const engine = new ForceGraph3D(host, { controlType: 'orbit' }) as unknown as Engine;
    engine
      .backgroundColor(CANVAS_BG)
      .showNavInfo(false)
      .nodeId('id')
      .nodeLabel(nodeTooltip)
      .nodeVal(nodeVal)
      .nodeRelSize(3)
      .nodeOpacity(0.92)
      .nodeColor((n) => nodeColor(n, stateRef.current))
      .linkColor((l) => (linkTouchesSelection(l, stateRef.current) ? STATE_COLORS.selected : LINK_COLORS[l.type]))
      .linkVisibility((l) => !stateRef.current.selectedId || linkTouchesSelection(l, stateRef.current))
      .linkWidth((l) => (linkTouchesSelection(l, stateRef.current) ? 1.2 : 0))
      .linkOpacity(0.35)
      .onNodeClick((n) => onSelectRef.current(n.id))
      .onBackgroundClick(() => onSelectRef.current(null))
      .onNodeHover((n) => { host.style.cursor = n ? 'pointer' : ''; })
      .onEngineStop(() => {
        if (!fitPendingRef.current) return;
        fitPendingRef.current = false;
        engine.zoomToFit(FIT_MS, FIT_PADDING);
      });
    engineRef.current = engine;

    const resize = new ResizeObserver(([entry]) => {
      engine.width(entry.contentRect.width).height(entry.contentRect.height);
    });
    resize.observe(host);

    return () => {
      resize.disconnect();
      engine._destructor();
      engineRef.current = null;
    };
  }, []);

  // New data: tune per-object detail to the graph size, then hand it to the engine.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine
      .nodeResolution(graph.nodes.length > DETAILED_NODES ? 6 : 12)
      .linkDirectionalArrowLength(graph.links.length > ARROW_LINKS ? 0 : 2.5)
      .linkDirectionalArrowRelPos(1)
      .graphData({ nodes: graph.nodes, links: graph.links });
  }, [graph]);

  // Visual state changed: re-run the accessors (setting the same accessor forces a recolor).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine
      .nodeColor(engine.nodeColor())
      .linkColor(engine.linkColor())
      .linkVisibility(engine.linkVisibility())
      .linkWidth(engine.linkWidth());
  }, [selectedId, adjacency, overlay]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !flyTo) return;
    const node = graph.nodes.find((n) => n.id === flyTo.id);
    if (!node || node.x === undefined || node.y === undefined || node.z === undefined) return;
    const dist = Math.hypot(node.x, node.y, node.z) || 1;
    const ratio = 1 + FLY_DISTANCE / dist;
    engine.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
      { x: node.x, y: node.y, z: node.z },
      FLY_MS,
    );
    // graph.nodes is intentionally read, not tracked: only an explicit request moves the camera.
  }, [flyTo]);

  // A new view (level/scope/focus) frames itself once the layout settles; live refreshes don't.
  useEffect(() => {
    fitPendingRef.current = true;
  }, [fitKey]);

  return <div ref={hostRef} className={styles.canvas} role="img" aria-label="3D code graph" />;
}
