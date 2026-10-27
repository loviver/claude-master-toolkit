import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import {
  CANVAS_BG,
  IMPACT_COLORS,
  KIND_COLORS,
  LINK_COLORS,
  STATE_COLORS,
  clusterForce,
  clusterKey,
  collideForce,
  forceTuning,
  heatColor,
  kindCategory,
  labelCandidates,
  labelTop,
  tooltipBox,
  linkEnds,
  linkWidth3D,
  neighbourhood,
  nodeRadius3D,
  nodeVal,
  pinNode,
  reviewColor,
  placeLabels,
  unpinNode,
  zoneCentroids,
  type LabelBox,
  type Neighbours,
  type RenderGraph,
  type RenderLink,
  type RenderNode,
} from './graph-model';
import { anchorForce, radialLayout, ringLabel, ringRadii } from './impact-layout';
import type { CodeGraphChangeStatus } from '../../lib/types';
import styles from './GraphCanvas.module.css';

type Engine = ForceGraph3DInstance<RenderNode, RenderLink>;

export interface CodeGraphOverlay {
  touched: ReadonlySet<string>;
  blast: ReadonlySet<string>;
  /** Ids reindexed recently, rendered as "hot". */
  hot: ReadonlySet<string>;
  /** Nodes of a traced A→B path; when set, everything off the path dims. */
  path: ReadonlySet<string>;
  /** `s>t` keys of the path's hops (see `pathLinkKeys`). */
  pathLinks: ReadonlySet<string>;
  /** Git status per changed node (review paint). */
  status: ReadonlyMap<string, CodeGraphChangeStatus>;
  /** Nodes of the file open in the editor: always lit and labelled, so the code beside the graph has a place in it. */
  viewing: ReadonlySet<string>;
  /** Review mode: hops upstream from the diff; when set, nodes paint git-style and the rest goes gray. */
  impact: ReadonlyMap<string, number> | null;
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
  /** Node size as 0..1; rank when absent. */
  sizeScale?: ((n: RenderNode) => number) | null;
  /** Per-node 0..1 heat; when set it colors nodes instead of kind. */
  heat?: ReadonlyMap<string, number> | null;
  /** Impact view: hops from the focus; when set, nodes settle on one ring per hop on the z = 0 plane. */
  rings?: ReadonlyMap<string, number> | null;
  onSelect: (id: string | null) => void;
}

interface Strength { strength(): unknown; strength(v: unknown): unknown }

/** Above these sizes per-object detail costs more frame time than it adds meaning. */
const DETAILED_NODES = 1500;
const ARROW_LINKS = 4000;
const BIG_ARROW_LINKS = 400;
/** The open file's nodes grow by this much, on top of their metric size. */
const VIEWING_GROW = 1.8;
/** Above this, idle links draw as 1px lines; weighted widths need a cylinder mesh per link. */
const WEIGHTED_LINKS = 1500;
/** Camera distance for a node with no neighbours to frame it against. */
const FLY_DISTANCE = 300;
const FLY_MS = 1200;
const FIT_MS = 600;
const FIT_PADDING = 40;
const FOCUS_PADDING = 80;
/** Pull toward the zone centre; low enough that call edges still shape the islands. */
const CLUSTER_STRENGTH = 0.08;
/** Folders deep enough to tell features apart, not just `src/client` from `src/server`. */
const CLUSTER_DEPTH = 3;
/** Idle links stay faint context; a selection brings its own forward. */
const IDLE_LINK_OPACITY = 0.18;
const FOCUS_LINK_OPACITY = 0.5;
/** Labels offered to the declutter pass each frame; zooming in lets more of them fit. */
const MAX_NODE_LABELS = 120;
const MAX_ZONE_LABELS = 40;
const LABEL_GAP = 4;
const NODE_REL_SIZE = 3;
/** Empty space kept between two spheres by the collision force. */
const COLLIDE_PADDING = 2;
/** Impact rings: room between hops and between neighbours on a ring, in world units. */
const RING_GAP = 50;
const RING_PADDING = 6;
/** How hard nodes are eased onto their ring each tick (times alpha). */
const ANCHOR_STRENGTH = 0.3;

interface VisualState {
  selectedId: string | null;
  adjacency: Map<string, Neighbours>;
  overlay: CodeGraphOverlay;
  heat: ReadonlyMap<string, number> | null;
  sizeScale: ((n: RenderNode) => number) | null;
}

function isNeighbour(state: VisualState, id: string): boolean {
  if (state.overlay.path.size) return state.overlay.path.has(id);
  if (!state.selectedId) return true;
  if (id === state.selectedId) return true;
  const n = state.adjacency.get(state.selectedId);
  return !!n && (n.callers.has(id) || n.deps.has(id));
}

function nodeColor(node: RenderNode, state: VisualState): string {
  if (node.id === state.selectedId) return STATE_COLORS.selected;
  // The open file keeps its own color (its git status in review); the label marks it, it never dims.
  if (!state.overlay.viewing.has(node.id) && !isNeighbour(state, node.id)) return STATE_COLORS.dim;
  if (state.overlay.impact) return reviewColor(node.id, state.overlay.status, state.overlay.impact);
  if (state.overlay.touched.has(node.id)) return STATE_COLORS.touched;
  if (state.overlay.blast.has(node.id)) return STATE_COLORS.blast;
  if (state.overlay.hot.has(node.id)) return STATE_COLORS.hot;
  const t = state.heat?.get(node.id);
  if (t !== undefined) return heatColor(t);
  return KIND_COLORS[kindCategory(node.kind)];
}

function linkTouchesSelection(link: RenderLink, state: VisualState): boolean {
  const [s, t] = linkEnds(link);
  if (state.overlay.path.size) return state.overlay.pathLinks.has(`${s}>${t}`);
  return s === state.selectedId || t === state.selectedId;
}

function valOf(node: RenderNode, state: VisualState): number {
  const { sizeScale: scale, overlay: o } = state;
  return nodeVal(node, scale ? scale(node) : node.rank) * (o.viewing.has(node.id) ? VIEWING_GROW : 1);
}

/** Hover card for a node; drawn beside its sphere by the label loop, never under the cursor. */
function NodeTooltip({ node }: { node: RenderNode }) {
  return (
    <>
      <b>{node.label}</b> · {node.kind}
      {node.file && node.kind !== 'file' && <><br /><span>{node.file}</span></>}
    </>
  );
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

export function CodeGraph3D({ graph, adjacency, selectedId, overlay, flyTo, fitKey, fitAll, sizeScale = null, heat = null, rings = null, onSelect }: CodeGraph3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const nodesById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const nodesByIdRef = useRef(nodesById);
  nodesByIdRef.current = nodesById;
  const viewportRef = useRef({ width: 0, height: 0 });
  const nodeLabels = useMemo(
    () => labelCandidates(graph.nodes, selectedId, adjacency, MAX_NODE_LABELS, overlay.viewing),
    [graph, selectedId, adjacency, overlay.viewing],
  );
  const zones = useMemo(() => zoneNames(graph.nodes), [graph]);
  const engineRef = useRef<Engine | null>(null);
  // Accessors read through refs so selection/overlay changes recolor without rebuilding the scene.
  const stateRef = useRef<VisualState>({ selectedId, adjacency, overlay, heat, sizeScale });
  stateRef.current = { selectedId, adjacency, overlay, heat, sizeScale };
  /** Impact view: each node's place on its ring, shared by the anchor force and the ring chips. */
  const ringPositions = useMemo(
    () => rings && radialLayout(
      graph.nodes.map((n) => n.id),
      rings,
      adjacency,
      (id) => nodeRadius3D(valOf(nodesById.get(id)!, stateRef.current), NODE_REL_SIZE),
      { ringGap: RING_GAP, padding: RING_PADDING },
    ),
    // sizeScale: ring spacing follows the sphere sizes read through stateRef.
    [graph, adjacency, rings, nodesById, sizeScale],
  );
  const ringGuides = useMemo(
    () => (rings && ringPositions ? ringRadii(graph.nodes.map((n) => n.id), rings, ringPositions) : []),
    [graph, rings, ringPositions],
  );
  const [hovered, setHovered] = useState<RenderNode | null>(null);
  const hoveredRef = useRef(hovered);
  hoveredRef.current = hovered;
  const tooltipRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const fitPendingRef = useRef(true);
  /** The engine's default link strength, restored when an impact view hands the layout back to the forces. */
  const linkStrengthRef = useRef<unknown>(null);

  // Mount the engine once per component lifetime.
  useEffect(() => {
    const host = hostRef.current!;
    const engine = new ForceGraph3D(host, { controlType: 'orbit' }) as unknown as Engine;
    engine
      .backgroundColor(CANVAS_BG)
      .showNavInfo(false)
      .nodeId('id')
      // Our own hover card (see NodeTooltip): the engine's follows the cursor, over the node.
      .nodeLabel(() => '')
      .nodeVal((n) => valOf(n, stateRef.current))
      .nodeRelSize(NODE_REL_SIZE)
      .nodeOpacity(0.92)
      .nodeColor((n) => nodeColor(n, stateRef.current))
      .linkColor((l) => (linkTouchesSelection(l, stateRef.current) ? STATE_COLORS.selected : LINK_COLORS[l.type]))
      .linkVisibility((l) => !stateRef.current.selectedId || linkTouchesSelection(l, stateRef.current))
      .linkWidth((l) => {
        if (linkTouchesSelection(l, stateRef.current)) return 1.2;
        return graphRef.current.links.length > WEIGHTED_LINKS ? 0 : linkWidth3D(l.weight);
      })
      .linkOpacity(IDLE_LINK_OPACITY)
      // Particles show call direction on the selection only; on every link they would be noise.
      .linkDirectionalParticles((l) => (linkTouchesSelection(l, stateRef.current) ? 2 : 0))
      .linkDirectionalParticleWidth(1.6)
      .linkDirectionalParticleSpeed(0.006)
      .linkDirectionalParticleColor(() => (stateRef.current.overlay.impact ? IMPACT_COLORS[0] : STATE_COLORS.selected))
      .linkDirectionalArrowColor((l) => (linkTouchesSelection(l, stateRef.current) ? STATE_COLORS.selected : LINK_COLORS[l.type]))
      .onNodeClick((n) => onSelectRef.current(n.id))
      // Drop pins a node so a hand-made arrangement survives; right-click releases it.
      .onNodeDragEnd((n) => pinNode(n))
      .onNodeRightClick((n) => {
        unpinNode(n);
        engine.d3ReheatSimulation();
      })
      .onBackgroundClick(() => onSelectRef.current(null))
      .onNodeHover((n) => {
        host.style.cursor = n ? 'pointer' : '';
        setHovered(n);
      })
      .onEngineStop(() => {
        if (!fitPendingRef.current) return;
        fitPendingRef.current = false;
        engine.zoomToFit(FIT_MS, FIT_PADDING);
      })
      .d3Force('cluster', clusterForce(CLUSTER_STRENGTH, (n) => clusterKey(n, CLUSTER_DEPTH)));
    linkStrengthRef.current = (engine.d3Force('link') as unknown as Strength | undefined)?.strength();
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
    const tuning = forceTuning(graph.nodes.length);
    const link = engine.d3Force('link') as unknown as (Strength & { distance(f: (l: RenderLink) => number): void }) | undefined;
    link?.distance((l) => tuning.linkDistance[l.type]);
    // Impact view: the rings are the layout, so the free forces step aside and an anchor eases
    // each node onto its ring (the link force stays registered: it resolves link ends).
    const radius = (n: RenderNode) => nodeRadius3D(valOf(n, stateRef.current), NODE_REL_SIZE);
    const anchor = ringPositions && anchorForce(ringPositions, ANCHOR_STRENGTH);
    (engine.d3Force('charge') as unknown as Strength | undefined)?.strength(anchor ? 0 : tuning.charge);
    link?.strength(anchor ? 0 : linkStrengthRef.current);
    engine
      .d3Force('cluster', anchor ? null : clusterForce(CLUSTER_STRENGTH, (n) => clusterKey(n, CLUSTER_DEPTH)))
      .d3Force('anchor', anchor || null)
      // Spheres never overlap; above DETAILED_NODES the pair checks cost more than they show.
      .d3Force('collide', graph.nodes.length > DETAILED_NODES ? null : collideForce(radius, COLLIDE_PADDING))
      // No warmup into the rings: the glide from the old layout is the point.
      .warmupTicks(anchor ? 0 : tuning.warmupTicks)
      .cooldownTicks(tuning.cooldownTicks)
      .nodeResolution(graph.nodes.length > DETAILED_NODES ? 6 : 12)
      // Few links (an impact view): arrows big enough to read who calls whom.
      .linkDirectionalArrowLength(graph.links.length > ARROW_LINKS ? 0 : graph.links.length > BIG_ARROW_LINKS ? 2.5 : 5)
      .linkDirectionalArrowRelPos(1)
      .graphData({ nodes: graph.nodes, links: graph.links });
  }, [graph, ringPositions]);

  // Visual state changed: re-run the accessors (setting the same accessor forces a recolor).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine
      .nodeColor(engine.nodeColor())
      .linkColor(engine.linkColor())
      .linkVisibility(engine.linkVisibility())
      .linkWidth(engine.linkWidth())
      .linkDirectionalParticles(engine.linkDirectionalParticles())
      .linkDirectionalArrowColor(engine.linkDirectionalArrowColor())
      .nodeVal(engine.nodeVal())
      .linkOpacity(selectedId ? FOCUS_LINK_OPACITY : IDLE_LINK_OPACITY);
  }, [selectedId, adjacency, overlay, heat]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.nodeVal(engine.nodeVal());
    // The collide force caches radii: re-register it so the new sizes push apart.
    if (engine.d3Force('collide')) {
      engine
        .d3Force('collide', collideForce((n) => nodeRadius3D(valOf(n, stateRef.current), NODE_REL_SIZE), COLLIDE_PADDING))
        .d3ReheatSimulation();
    }
  }, [sizeScale]);

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

      const camera = engine.camera();
      const m = camera.matrixWorldInverse.elements;
      // The camera's up axis in world space: a node's radius along it projects to its screen radius.
      const up = camera.matrixWorld.elements;
      const [ux, uy, uz] = [up[4], up[5], up[6]];
      const { width, height } = viewportRef.current;
      const screenRadius = (p: RenderNode & { x: number; y: number; z: number }, s: { x: number; y: number }) => {
        const r = nodeRadius3D(valOf(p, stateRef.current), NODE_REL_SIZE);
        const rim = engine.graph2ScreenCoords(p.x + ux * r, p.y + uy * r, p.z + uz * r);
        return Math.hypot(rim.x - s.x, rim.y - s.y);
      };

      // The hover card: beside the sphere, measured each frame (its text changes per node).
      const tip = tooltipRef.current;
      const hov = hoveredRef.current;
      if (tip) {
        const placed = hov && hov.x !== undefined && hov.y !== undefined && hov.z !== undefined;
        if (placed) {
          const p = hov as RenderNode & { x: number; y: number; z: number };
          const s = engine.graph2ScreenCoords(p.x, p.y, p.z);
          const at = tooltipBox(s, screenRadius(p, s), tip.offsetWidth, tip.offsetHeight, { width, height }, LABEL_GAP);
          tip.style.transform = `translate(${at.x}px, ${at.y}px)`;
        }
        tip.style.visibility = placed ? 'visible' : 'hidden';
      }

      const centroids = els.some((el) => el.dataset.zone !== undefined)
        ? new Map(zoneCentroids(graphRef.current.nodes).map((z) => [z.group, z]))
        : new Map();
      const boxes: LabelBox[] = [];
      const anchors = new Map<string, { x: number; y: number }>();
      els.forEach((el, i) => {
        const zone = el.dataset.zone;
        const ring = el.dataset.ring;
        // A ring chip names its ring at the top edge, on the plane the rings lie in.
        const p = ring !== undefined
          ? { x: 0, y: Number(ring), z: 0 }
          : zone !== undefined ? centroids.get(zone) : nodesByIdRef.current.get(el.dataset.node!);
        if (!p || p.x === undefined || p.y === undefined || p.z === undefined) return;
        // View-space z >= 0 means the anchor is behind the camera.
        if (m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14] >= 0) return;
        const s = engine.graph2ScreenCoords(p.x, p.y, p.z);
        const { w, h } = sizes.get(el)!;
        const x = s.x - w / 2;
        let y = s.y - h / 2;
        if (zone === undefined && ring === undefined) {
          // A node label sits above its sphere's projected disc, never across it.
          y = labelTop(s.y, screenRadius(p as RenderNode & { x: number; y: number; z: number }, s), h, LABEL_GAP);
        }
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
        {ringGuides.map((g) => (
          <span key={`r:${g.hop}`} data-ring={g.radius} className={styles.ringLabel}>{ringLabel(g.hop)}</span>
        ))}
        {!selectedId && zones.map((group) => (
          <span key={`z:${group}`} data-zone={group} className={styles.zoneLabel}>{group}</span>
        ))}
        {nodeLabels.map((n) => (
          <span
            key={`n:${n.id}`}
            data-node={n.id}
            className={[
              styles.nodeLabel,
              n.id === selectedId && styles.selectedLabel,
              overlay.viewing.has(n.id) && styles.viewingLabel,
            ].filter(Boolean).join(' ')}
          >
            {n.label}
          </span>
        ))}
      </div>
      <div className={styles.labels} aria-hidden="true">
        <div ref={tooltipRef} className={`${styles.tooltip} ${styles.nodeTooltip}`}>
          {hovered && <NodeTooltip node={hovered} />}
        </div>
      </div>
    </>
  );
}
