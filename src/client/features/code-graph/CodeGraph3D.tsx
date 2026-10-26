import { useEffect, useMemo, useRef } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import {
  CANVAS_BG,
  KIND_COLORS,
  LINK_COLORS,
  STATE_COLORS,
  clusterForce,
  escapeHtml,
  kindCategory,
  labelCandidates,
  linkEnds,
  neighbourhood,
  nodeVal,
  placeLabels,
  zoneCentroids,
  type LabelBox,
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
  /** Bumping it reframes the whole graph (the "overview" button). */
  fitAll: number;
  onSelect: (id: string | null) => void;
}

/** Above these sizes per-object detail costs more frame time than it adds meaning. */
const DETAILED_NODES = 1500;
const ARROW_LINKS = 4000;
/** Camera distance for a node with no neighbours to frame it against. */
const FLY_DISTANCE = 300;
const FLY_MS = 1200;
const FIT_MS = 600;
const FIT_PADDING = 40;
const FOCUS_PADDING = 80;
/** Pull toward the zone centre; low enough that call edges still shape the islands. */
const CLUSTER_STRENGTH = 0.08;
/** Labels offered to the declutter pass each frame; zooming in lets more of them fit. */
const MAX_NODE_LABELS = 120;
const MAX_ZONE_LABELS = 40;
const LABEL_GAP = 4;

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

/** Zones worth naming, biggest first; a view with a single zone has nothing to tell apart. */
function zoneNames(nodes: RenderNode[]): string[] {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
  if (counts.size < 2) return [];
  return [...counts]
    .sort(([a, ca], [b, cb]) => cb - ca || a.localeCompare(b))
    .slice(0, MAX_ZONE_LABELS)
    .map(([group]) => group);
}

export function CodeGraph3D({ graph, adjacency, selectedId, overlay, flyTo, fitKey, fitAll, onSelect }: CodeGraph3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;
  const viewportRef = useRef({ width: 0, height: 0 });
  const nodeLabels = useMemo(
    () => labelCandidates(graph.nodes, selectedId, adjacency, MAX_NODE_LABELS),
    [graph, selectedId, adjacency],
  );
  const zones = useMemo(() => zoneNames(graph.nodes), [graph]);
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
      })
      .d3Force('cluster', clusterForce(CLUSTER_STRENGTH));
    engineRef.current = engine;

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      viewportRef.current = { width, height };
      engine.width(width).height(height);
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

  // Frame the node together with its callers and deps, so the jump keeps its context.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !flyTo) return;
    const near = neighbourhood(flyTo.id, stateRef.current.adjacency);
    if (near.size > 1) {
      engine.zoomToFit(FLY_MS, FOCUS_PADDING, (n) => near.has(n.id));
      return;
    }
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

  useEffect(() => {
    if (fitAll) engineRef.current?.zoomToFit(FIT_MS, FIT_PADDING);
  }, [fitAll]);

  // Labels are DOM, positioned every frame: project each anchor to the screen, then keep
  // the ones that fit without overlapping, in priority (DOM) order.
  useEffect(() => {
    const sizes = new WeakMap<HTMLElement, { w: number; h: number }>();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const engine = engineRef.current;
      const layer = labelsRef.current;
      if (!engine || !layer) return;
      const els = Array.from(layer.children) as HTMLElement[];
      for (const el of els) if (!sizes.has(el)) sizes.set(el, { w: el.offsetWidth, h: el.offsetHeight });

      const m = engine.camera().matrixWorldInverse.elements;
      const { width, height } = viewportRef.current;
      const centroids = els.some((el) => el.dataset.zone !== undefined)
        ? new Map(zoneCentroids(graphRef.current.nodes).map((z) => [z.group, z]))
        : new Map();
      const boxes: LabelBox[] = [];
      const anchors = new Map<string, { x: number; y: number }>();
      els.forEach((el, i) => {
        const zone = el.dataset.zone;
        const p = zone !== undefined ? centroids.get(zone) : nodesByIdRef.current.get(el.dataset.node!);
        if (!p || p.x === undefined || p.y === undefined || p.z === undefined) return;
        // View-space z >= 0 means the anchor is behind the camera.
        if (m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14] >= 0) return;
        const s = engine.graph2ScreenCoords(p.x, p.y, p.z);
        const { w, h } = sizes.get(el)!;
        const x = s.x - w / 2;
        const y = zone !== undefined ? s.y - h / 2 : s.y - h - LABEL_GAP;
        if (x + w < 0 || y + h < 0 || x > width || y > height) return;
        const id = String(i);
        boxes.push({ id, x, y, w, h });
        anchors.set(id, { x, y });
      });
      const shown = placeLabels(boxes);
      els.forEach((el, i) => {
        const at = shown.has(String(i)) ? anchors.get(String(i)) : undefined;
        el.style.visibility = at ? 'visible' : 'hidden';
        if (at) el.style.transform = `translate(${at.x}px, ${at.y}px)`;
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <>
      <div ref={hostRef} className={styles.canvas} role="img" aria-label="3D code graph" />
      <div ref={labelsRef} className={styles.labels} aria-hidden="true">
        {!selectedId && zones.map((group) => (
          <span key={`z:${group}`} data-zone={group} className={styles.zoneLabel}>{group}</span>
        ))}
        {nodeLabels.map((n) => (
          <span
            key={`n:${n.id}`}
            data-node={n.id}
            className={n.id === selectedId ? `${styles.nodeLabel} ${styles.selectedLabel}` : styles.nodeLabel}
          >
            {n.label}
          </span>
        ))}
      </div>
    </>
  );
}
