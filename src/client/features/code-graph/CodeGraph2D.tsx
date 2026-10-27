import { useEffect, useRef } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import type { NodeHoverDrawingFunction } from 'sigma/rendering';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import { inferSettings } from 'graphology-layout-forceatlas2';
import {
  CANVAS_BG,
  KIND_COLORS,
  LINK_COLORS,
  STATE_COLORS,
  kindCategory,
  linkEnds,
  strongerLink,
  type Neighbours,
  type RenderGraph,
} from './graph-model';
import type { CodeGraphLinkType } from '../../lib/types';
import type { CodeGraphOverlay } from './CodeGraph3D';
import { seedPosition } from './explorer-model';
import styles from './GraphCanvas.module.css';

/**
 * 2D WebGL renderer: Sigma draws, ForceAtlas2 (in a web worker) lays out. The view a
 * code explorer needs day to day — flat, legible labels, hover lights up a node's
 * neighbourhood — where the 3D view is for getting a feel of the whole shape.
 */

interface NodeAttrs {
  x: number;
  y: number;
  size: number;
  label: string;
  kind: string;
  group: string;
}

interface EdgeAttrs {
  size: number;
  linkType: CodeGraphLinkType;
}

type CodeSigma = Sigma<NodeAttrs, EdgeAttrs>;

interface CodeGraph2DProps {
  graph: RenderGraph;
  adjacency: Map<string, Neighbours>;
  selectedId: string | null;
  overlay: CodeGraphOverlay;
  /** Glide the camera to this node; `nonce` lets the same id be requested twice. */
  flyTo: { id: string; nonce: number } | null;
  /** Identity of the current view; changing it reframes the camera once the layout settles. */
  fitKey: string;
  /** Bumping it reframes the whole graph (the "overview" button). */
  fitAll: number;
  /** Color nodes by zone (group) instead of by kind. */
  zoneColors?: ReadonlyMap<string, string> | null;
  onSelect: (id: string | null) => void;
}

/** Above this many edges arrowheads are noise and cost frame time. */
const ARROW_EDGES = 5000;
const LABEL_COLOR = '#cccccc';                  // --vscode-foreground
const HOVER_BOX = '#202020';                    // --vscode-editorWidget-background
/** Edge colors carry alpha so dense regions read as density, not as a solid fill. */
const EDGE_ALPHA = '55';
const EDGE_FOCUS_ALPHA = 'dd';
const FLY_MS = 500;
const FLY_RATIO = 0.35;
const FIT_MS = 500;

/** How long ForceAtlas2 runs before the layout freezes; bigger graphs need longer to settle. */
function layoutMs(order: number, firstRun: boolean): number {
  if (!firstRun) return 1200;
  return Math.min(8000, 1500 + order * 3);
}

function nodeSize(rank: number): number {
  return 3 + 14 * Math.sqrt(rank);
}

/** Dark label chip for hovered/selected nodes; Sigma's default is a white box built for light canvases. */
const drawHover: NodeHoverDrawingFunction<NodeAttrs, EdgeAttrs> = (ctx, data, settings) => {
  const size = settings.labelSize;
  ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
  const label = data.label ?? '';
  const w = label ? ctx.measureText(label).width + 10 : 0;
  const h = size + 8;
  ctx.fillStyle = HOVER_BOX;
  ctx.strokeStyle = data.color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(data.x + data.size + 2, data.y - h / 2, w, h, 4);
  if (label) {
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(label, data.x + data.size + 7, data.y + size / 3);
  }
  ctx.beginPath();
  ctx.arc(data.x, data.y, data.size + 3, 0, Math.PI * 2);
  ctx.strokeStyle = data.color;
  ctx.lineWidth = 2;
  ctx.stroke();
};

interface VisualState {
  selectedId: string | null;
  hoveredId: string | null;
  adjacency: Map<string, Neighbours>;
  overlay: CodeGraphOverlay;
  zoneColors: ReadonlyMap<string, string> | null;
}

function isNear(state: VisualState, focus: string, id: string): boolean {
  if (id === focus) return true;
  const n = state.adjacency.get(focus);
  return !!n && (n.callers.has(id) || n.deps.has(id));
}

function baseColor(id: string, data: NodeAttrs, state: VisualState): string {
  if (id === state.selectedId) return STATE_COLORS.selected;
  if (state.overlay.touched.has(id)) return STATE_COLORS.touched;
  if (state.overlay.blast.has(id)) return STATE_COLORS.blast;
  if (state.overlay.hot.has(id)) return STATE_COLORS.hot;
  return state.zoneColors?.get(data.group) ?? KIND_COLORS[kindCategory(data.kind)];
}

export function CodeGraph2D({
  graph, adjacency, selectedId, overlay, flyTo, fitKey, fitAll, zoneColors = null, onSelect,
}: CodeGraph2DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<CodeSigma | null>(null);
  const modelRef = useRef<Graph<NodeAttrs, EdgeAttrs> | null>(null);
  const layoutRef = useRef<{ fa2: FA2Layout; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stateRef = useRef<VisualState>({ selectedId, hoveredId: null, adjacency, overlay, zoneColors });
  stateRef.current = { ...stateRef.current, selectedId, adjacency, overlay, zoneColors };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  /** Set when the view changed: frame it once the layout has settled. */
  const pendingFitRef = useRef(true);

  // ── Mount: one Sigma instance for the component's life ──
  useEffect(() => {
    const model = new Graph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: false, allowSelfLoops: false });
    const sigma: CodeSigma = new Sigma(model, hostRef.current!, {
      renderEdgeLabels: false,
      defaultEdgeType: 'arrow',
      labelColor: { color: LABEL_COLOR },
      labelFont: 'Inter, system-ui, sans-serif',
      labelSize: 12,
      labelWeight: '500',
      labelDensity: 0.6,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 7,
      defaultDrawNodeHover: drawHover,
      zIndex: true,
      minCameraRatio: 0.02,
      maxCameraRatio: 4,
      stagePadding: 40,
      nodeReducer: (id, data) => {
        const state = stateRef.current;
        const focus = state.hoveredId ?? state.selectedId;
        const color = baseColor(id, data, state);
        if (!focus) return { ...data, color };
        if (!isNear(state, focus, id)) return { ...data, color: STATE_COLORS.dim, label: '', zIndex: 0 };
        return {
          ...data,
          color,
          zIndex: 2,
          forceLabel: true,
          highlighted: id === state.selectedId || id === state.hoveredId,
          size: id === focus ? data.size * 1.3 : data.size,
        };
      },
      edgeReducer: (edge, data) => {
        const state = stateRef.current;
        const focus = state.hoveredId ?? state.selectedId;
        const color = LINK_COLORS[data.linkType];
        if (!focus) return { ...data, color: color + EDGE_ALPHA };
        const [s, t] = model.extremities(edge);
        if (s !== focus && t !== focus) return { ...data, hidden: true };
        return { ...data, color: color + EDGE_FOCUS_ALPHA, size: data.size + 1, zIndex: 2 };
      },
    });

    sigma.on('clickNode', ({ node }) => onSelectRef.current(node));
    sigma.on('clickStage', () => onSelectRef.current(null));
    sigma.on('enterNode', ({ node }) => {
      stateRef.current = { ...stateRef.current, hoveredId: node };
      hostRef.current!.style.cursor = 'pointer';
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on('leaveNode', () => {
      stateRef.current = { ...stateRef.current, hoveredId: null };
      hostRef.current!.style.cursor = '';
      sigma.refresh({ skipIndexation: true });
    });

    // Dragging the split sash resizes the host: Sigma must re-measure or the canvas stretches.
    const resize = new ResizeObserver(() => { sigma.resize(); sigma.refresh(); });
    resize.observe(hostRef.current!);
    sigmaRef.current = sigma;
    modelRef.current = model;
    return () => {
      if (layoutRef.current) {
        clearTimeout(layoutRef.current.timer);
        layoutRef.current.fa2.kill();
      }
      resize.disconnect();
      sigma.kill();
      sigmaRef.current = null;
      modelRef.current = null;
    };
  }, []);

  // A new view (project, level, scope, focus) gets framed once laid out. Declared
  // before the sync effect so it is already set when the new view's graph arrives.
  useEffect(() => { pendingFitRef.current = true; }, [fitKey]);

  // ── Sync the graphology model with the render graph; positions of surviving nodes stay put ──
  useEffect(() => {
    const model = modelRef.current;
    const sigma = sigmaRef.current;
    if (!model || !sigma) return;
    const firstRun = model.order === 0;

    const keep = new Set(graph.nodes.map((n) => n.id));
    model.forEachNode((id) => { if (!keep.has(id)) model.dropNode(id); });

    const zones = [...new Set(graph.nodes.map((n) => n.group))].sort();
    const zoneIndex = new Map(zones.map((z, i) => [z, i]));
    let added = 0;
    for (const n of graph.nodes) {
      const attrs = { size: nodeSize(n.rank), label: n.label, kind: n.kind, group: n.group };
      if (model.hasNode(n.id)) {
        model.mergeNodeAttributes(n.id, attrs);
        continue;
      }
      added++;
      // A newcomer starts next to a neighbour already placed, else on its zone's island.
      const near = [...(adjacency.get(n.id)?.callers ?? []), ...(adjacency.get(n.id)?.deps ?? [])]
        .find((id) => model.hasNode(id));
      const seed = seedPosition(n.id, zoneIndex.get(n.group)!, zones.length);
      const pos = near
        ? { x: model.getNodeAttribute(near, 'x') + seed.x / 20, y: model.getNodeAttribute(near, 'y') + seed.y / 20 }
        : seed;
      model.addNode(n.id, { ...attrs, ...pos });
    }

    // Sigma draws one edge per direction: link types between the same pair fold into the strongest.
    const want = new Map<string, { source: string; target: string; weight: number; type: CodeGraphLinkType }>();
    for (const l of graph.links) {
      const [source, target] = linkEnds(l);
      const key = `${source}\0${target}`;
      const prev = want.get(key);
      if (prev) {
        prev.weight += l.weight;
        prev.type = strongerLink(prev.type, l.type);
      } else {
        want.set(key, { source, target, weight: l.weight, type: l.type });
      }
    }
    model.forEachEdge((edge, _a, source, target) => {
      if (!want.has(`${source}\0${target}`)) model.dropEdge(edge);
    });
    for (const e of want.values()) {
      const attrs = { size: 0.6 + Math.log2(1 + e.weight) * 0.6, linkType: e.type };
      if (model.hasEdge(e.source, e.target)) model.mergeEdgeAttributes(e.source, e.target, attrs);
      else model.addDirectedEdge(e.source, e.target, attrs);
    }
    sigma.setSetting('defaultEdgeType', model.size > ARROW_EDGES ? 'line' : 'arrow');

    if (!firstRun && added === 0 && !pendingFitRef.current) {
      sigma.refresh();
      return;
    }

    // (Re)run ForceAtlas2 for a bounded time, then freeze: a settled map, not a living one.
    if (layoutRef.current) {
      clearTimeout(layoutRef.current.timer);
      layoutRef.current.fa2.kill();
    }
    const fa2 = new FA2Layout(model, {
      settings: {
        ...inferSettings(model),
        barnesHutOptimize: model.order > 400,
        outboundAttractionDistribution: true,
        adjustSizes: model.order < 2000,
        slowDown: 1 + Math.log(Math.max(1, model.order)),
      },
    });
    fa2.start();
    const timer = setTimeout(() => {
      fa2.stop();
      if (pendingFitRef.current) {
        pendingFitRef.current = false;
        void sigma.getCamera().animatedReset({ duration: FIT_MS });
      }
    }, layoutMs(model.order, firstRun || pendingFitRef.current));
    layoutRef.current = { fa2, timer };
  }, [graph, adjacency]);

  useEffect(() => {
    if (fitAll > 0) void sigmaRef.current?.getCamera().animatedReset({ duration: FIT_MS });
  }, [fitAll]);

  // Selection and overlays only restyle: no reindexing, no layout.
  useEffect(() => {
    sigmaRef.current?.refresh({ skipIndexation: true });
  }, [selectedId, overlay, adjacency, zoneColors]);

  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!flyTo || !sigma) return;
    const at = sigma.getNodeDisplayData(flyTo.id);
    if (!at) return;
    const camera = sigma.getCamera();
    void camera.animate({ x: at.x, y: at.y, ratio: Math.min(camera.ratio, FLY_RATIO) }, { duration: FLY_MS });
  }, [flyTo]);

  return <div ref={hostRef} className={styles.canvas2d} style={{ background: CANVAS_BG }} />;
}
