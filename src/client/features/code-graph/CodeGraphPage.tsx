import { Suspense, lazy, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import VscodeSingleSelect from '@vscode-elements/react-elements/dist/components/VscodeSingleSelect.js';
import VscodeOption from '@vscode-elements/react-elements/dist/components/VscodeOption.js';
import VscodeToolbarButton from '@vscode-elements/react-elements/dist/components/VscodeToolbarButton.js';
import { formatProjectName, formatRelativeTime } from '../../lib/format';
import type { CodeGraphLevel, CodeGraphSymbolRefDTO } from '../../lib/types';
import {
  useCodeGraph,
  useCodeGraphFiles,
  useCodeGraphProjects,
  useCodeGraphRevision,
  useCodeGraphRisk,
  useCodeGraphSource,
  useCodeGraphSymbolSearch,
} from '../../hooks/queries/useCodeGraph';
import { parseQualifiedId } from '../../../shared/indexer/ids';
import { DIFF_FOCUS } from '../../../shared/api-types';
import { ApiError } from '../../hooks/queries/api';
import {
  KIND_COLORS,
  KIND_LABELS,
  LINK_COLORS,
  LINK_LABELS,
  HEAT_COLORS,
  METRIC_LABELS,
  SIZE_METRICS,
  COLOR_MODES,
  STATE_COLORS,
  ZONE_OTHER,
  buildAdjacency,
  filterGraph,
  neighbourAt,
  parseHidden,
  pathLinkKeys,
  reviewSpotlight,
  impactDistance,
  IMPACT_COLORS,
  IMPACT_HOPS,
  serializeHidden,
  shortestPath,
  type HiddenKey,
  colorScale,
  metricScale,
  parseColorMode,
  parseSizeMetric,
  defaultLevel,
  mergeGraph,
  parseDirection,
  DIRECTIONS,
  searchNodes,
  zonePalette,
  type KindCategory,
  type RenderGraph,
} from './graph-model';
import type { CodeGraphOverlay } from './CodeGraph3D';
import { CodeGraph2D } from './CodeGraph2D';
import { focusSeeds, hopDistance } from './impact-layout';
import { NodeInspector } from './NodeInspector';
import { edgeIndex } from './inspector-model';
import { FileTree } from './FileTree';
import { CodeViewer } from './CodeViewer';
import { DiffViewer } from './DiffViewer';
import { ChangesPanel } from './ChangesPanel';
import { SymbolDetails } from './SymbolDetails';
import { StructureView } from './StructureView';
import { useCodeNavigation } from './useCodeNavigation';
import { QuickOpen, type QuickItem, type QuickOpenHandle, type QuickSection } from './QuickOpen';
import {
  nodeForCaret,
  symbolIcon,
  type NavLocation,
} from './nav-model';
import { fileNodeIds, nodeIdForFile } from './explorer-model';
import {
  GRAPH_TAB,
  activateTab,
  activeFileTab,
  closeTab,
  initialEditor,
  openFileTab,
  pinTab,
  toggleSplit,
  type EditorState,
} from './workbench-model';
import {
  ActivityBar,
  Breadcrumbs,
  Pane,
  Placeholder,
  ProgressLine,
  StatusBar,
  StatusItem,
  TitleBar,
  Sash,
  Workbench,
  useSash,
  type ActivityItem,
} from './workbench/Workbench';
import { EditorTabs } from './workbench/EditorTabs';
import { Codicon } from './workbench/codicons';
import list from './workbench/list.module.css';
import wb from './workbench/Workbench.module.css';
import canvas from './GraphCanvas.module.css';

// three.js is most of the page's weight: load it only when the 3D view is picked.
const CodeGraph3D = lazy(() => import('./CodeGraph3D').then((m) => ({ default: m.CodeGraph3D })));
const DependencyMatrix = lazy(() => import('./views/DependencyMatrix').then((m) => ({ default: m.DependencyMatrix })));
const LayeredView = lazy(() => import('./views/LayeredView').then((m) => ({ default: m.LayeredView })));
const ClassDiagram = lazy(() => import('./views/ClassDiagram').then((m) => ({ default: m.ClassDiagram })));
const TreemapView = lazy(() => import('./views/TreemapView').then((m) => ({ default: m.TreemapView })));
const CallHierarchy = lazy(() => import('./views/CallHierarchy').then((m) => ({ default: m.CallHierarchy })));

/** Ways to look at the same index; the first two are canvases, the rest are architecture views. */
const VIEWS = [
  { id: '2d', icon: 'type-hierarchy', label: '2D map: labels, hover neighbourhoods' },
  { id: '3d', icon: 'globe', label: '3D shape of the whole codebase' },
  { id: 'matrix', icon: 'table', label: 'Dependency matrix: cycles at a glance' },
  { id: 'layers', icon: 'layers', label: 'Layers: callers above what they use' },
  { id: 'treemap', icon: 'layout', label: 'Treemap: where the weight lives' },
  { id: 'classes', icon: 'symbol-class', label: 'Class diagram (Symbols level)' },
  { id: 'calls', icon: 'call-outgoing', label: 'Call hierarchy of the selected symbol' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];
const parseView = (raw: string | null): ViewId => VIEWS.find((v) => v.id === raw)?.id ?? '2d';

const LEVELS: Array<{ value: CodeGraphLevel; label: string }> = [
  { value: 'module', label: 'Modules' },
  { value: 'file', label: 'Files' },
  { value: 'symbol', label: 'Symbols' },
];
const LEVEL_KINDS: Record<CodeGraphLevel, KindCategory[]> = {
  module: ['module'],
  file: ['file'],
  symbol: ['callable', 'class', 'type', 'value'],
};
const DEPTHS = [1, 2, 3, 4];
/** How long a reindexed node stays highlighted as "hot". */
/** Server hard cap on graph nodes (`MAX_LIMIT`). */
const MAX_GRAPH_LIMIT = 10_000;
/** Server default cap (`DEFAULT_LIMIT`). */
const DEFAULT_GRAPH_LIMIT = 2000;
const HOT_MS = 60_000;
const HOT_TICK_MS = 5_000;

type UrlPatch = Partial<Record<'project' | 'level' | 'scope' | 'focus' | 'depth' | 'direction' | 'view' | 'split' | 'size' | 'color' | 'hide' | 'exp' | 'review' | 'sel' | 'limit', string | undefined>>;
type SideView = 'files' | 'structure' | 'changes';
/** Symbol hits listed under the graph's own matches. */
const SYMBOL_HITS_MAX = 30;

/** View state lives in the URL so a view can be bookmarked, shared, or linked to by an agent. */
function useGraphParams() {
  const [params, setParams] = useSearchParams();
  /** `replace` for state that changes often (the selection): no history entry per click. */
  const update = useCallback((patch: UrlPatch, opts?: { replace?: boolean }) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      return next;
    }, opts);
  }, [setParams]);
  return { params, update };
}

function parseLevel(raw: string | null): CodeGraphLevel | undefined {
  return LEVELS.some((l) => l.value === raw) ? (raw as CodeGraphLevel) : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    try { return (JSON.parse(err.body) as { error?: string }).error ?? err.message; } catch { return err.message; }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Next value in a fixed list, wrapping around: status-bar toggles cycle instead of opening a menu. */
function cycle<T>(values: readonly T[], current: T): T {
  return values[(values.indexOf(current) + 1) % values.length];
}

function legendToggleClass(off: boolean): string {
  return off ? `${canvas.legendToggle} ${canvas.legendOff}` : canvas.legendToggle;
}

const valueOf = (e: Event) => (e.target as HTMLInputElement).value;

/** The frame shown before there is a project to explore. */
function EmptyWorkbench({ loading }: { loading: boolean }) {
  return (
    <Workbench
      titleBar={<TitleBar start={null} center={null} end={null} />}
      activityBar={<ActivityBar items={[]} active={null} onSelect={() => {}} />}
      sideBar={null}
      editor={loading ? <div className={wb.editorContent}><ProgressLine /></div> : (
        <Placeholder icon="type-hierarchy-sub" title="No indexed projects yet">
          Run <code>ctk index build</code> inside a repository, then come back: its modules, files and symbols
          appear here and update as the index changes.
        </Placeholder>
      )}
      auxBar={null}
      statusBar={<StatusBar start={null} end={null} />}
    />
  );
}

export function CodeGraphPage() {
  const { params, update } = useGraphParams();
  const projects = useCodeGraphProjects();

  // Default to the most recently indexed project: the one being worked on right now.
  const byRecency = useMemo(
    () => [...(projects.data ?? [])].sort((a, b) => b.indexedAt - a.indexedAt),
    [projects.data],
  );
  const project = byRecency.find((p) => p.projectPath === params.get('project')) ?? byRecency[0];
  const projectPath = project?.projectPath;
  const level = parseLevel(params.get('level')) ?? (project ? defaultLevel(project) : 'module');
  const focus = params.get('focus') ?? undefined;
  // An impact view is project-wide (the server ignores scope too); drop a stale one from the URL.
  const scope = focus ? undefined : params.get('scope') ?? undefined;
  const depth = focus ? Number(params.get('depth') ?? 2) : undefined;
  const direction = focus ? parseDirection(params.get('direction')) : undefined;
  const viewId = parseView(params.get('view'));
  const sizeBy = parseSizeMetric(params.get('size'));
  const colorBy = parseColorMode(params.get('color'));
  const hideRaw = params.get('hide');
  const hidden = useMemo(() => parseHidden(hideRaw), [hideRaw]);
  const exportedOnly = params.get('exp') === '1';
  /** Review mode: spotlight the diff and its blast radius, dim the rest. */
  const reviewMode = params.get('review') === '1';
  const limitRaw = Number(params.get('limit'));
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_GRAPH_LIMIT) : undefined;
  const renderer = viewId === '3d' ? '3d' : '2d';
  const isCanvas = viewId === '2d' || viewId === '3d';
  const viewKey = JSON.stringify([projectPath, level, scope, focus, depth, direction]);

  const [live, setLive] = useState(true);
  const [showRisk, setShowRisk] = useState(false);
  const [worktree, setWorktree] = useState(true);
  // A changed file opens as its diff vs base; "Open the whole file" switches to the plain viewer.
  const [diffView, setDiffView] = useState(true);
  const [sideView, setSideView] = useState<SideView | null>('files');
  const [auxOpen, setAuxOpen] = useState(true);
  const [editor, setEditor] = useState<EditorState>(() => (params.get('split') === '1' ? toggleSplit(initialEditor) : initialEditor));
  const [linked, setLinked] = useState(true);
  const graphGroup = useSash(560, 280, 1400);
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('sel'));
  /** Start of an A→B trace; the selection is its end. */
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const stepRef = useRef({ id: '', direction: '', i: 0 });
  const [query, setQuery] = useState('');
  const [flyTo, setFlyTo] = useState<{ id: string; nonce: number } | null>(null);
  const [fitAll, setFitAll] = useState(0);
  const searchRef = useRef<QuickOpenHandle>(null);
  const splitRef = useRef(() => {});

  const revision = useCodeGraphRevision(projectPath, live);
  const rev = revision.data?.revision;
  const graphQuery = useCodeGraph({ project: projectPath, level, scope, focus, depth, direction, limit, worktree }, rev);
  // The changes view needs the diff even with the overlay off; the overlay paints what it lists.
  const wantRisk = showRisk || reviewMode || sideView === 'changes';
  const risk = useCodeGraphRisk(projectPath, level, rev, wantRisk, worktree);
  const files = useCodeGraphFiles(projectPath, rev);
  const symbolQuery = useDeferredValue(query.trim());
  const symbolHits = useCodeGraphSymbolSearch(projectPath, symbolQuery, rev);

  // Merge each fresh graph into the previous one of the same view (layout survives live refreshes).
  const [view, setView] = useState<{ key: string; graph: RenderGraph } | null>(null);
  const { data, isPlaceholderData } = graphQuery;
  useEffect(() => {
    if (!data || isPlaceholderData) return;
    setView((prev) => (prev?.key === viewKey && prev.graph.revision === data.revision
      ? prev
      : { key: viewKey, graph: mergeGraph(prev?.key === viewKey ? prev.graph : null, data) }));
  }, [data, isPlaceholderData, viewKey]);
  const fullGraph = view?.key === viewKey ? view.graph : null;
  // Filters apply to every view; node objects are shared, so toggling one keeps the layout.
  const graph = useMemo(
    () => fullGraph && filterGraph(fullGraph, { hidden, exportedOnly }),
    [fullGraph, hidden, exportedOnly],
  );

  // Reindexed nodes glow for HOT_MS, then fade back to their kind color.
  const [hotSince, setHotSince] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!fullGraph?.changed.length) return;
    const now = Date.now();
    setHotSince((prev) => new Map([...prev, ...fullGraph.changed.map((id) => [id, now] as const)]));
  }, [fullGraph]);
  useEffect(() => {
    if (hotSince.size === 0) return;
    const timer = setInterval(() => {
      setHotSince((prev) => {
        const cutoff = Date.now() - HOT_MS;
        const next = new Map([...prev].filter(([, at]) => at > cutoff));
        return next.size === prev.size ? prev : next;
      });
    }, HOT_TICK_MS);
    return () => clearInterval(timer);
  }, [hotSince.size]);
  useEffect(() => setHotSince(new Map()), [viewKey]);

  const adjacency = useMemo(() => buildAdjacency(graph?.links ?? []), [graph]);
  const nodesById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const edges = useMemo(() => edgeIndex(graph?.links ?? []), [graph]);
  /** The node a peek in the details panel is looking at: lit in the graph, never selected. */
  const [peekId, setPeekId] = useState<string | null>(null);
  const path = useMemo(
    () => (pathFrom && selectedId && pathFrom !== selectedId && nodesById.has(pathFrom)
      ? shortestPath(adjacency, pathFrom, selectedId) ?? []
      : []),
    [pathFrom, selectedId, adjacency, nodesById],
  );
  const activeTab = activeFileTab(editor);
  const viewingFile = activeTab?.file ?? null;
  /** The open file's nodes in this view, most ranked first; empty when the view does not draw it. */
  const viewingIds = useMemo(
    () => (viewingFile ? fileNodeIds(level, viewingFile, graph?.nodes ?? []) : []),
    [viewingFile, level, graph],
  );
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const viewingRef = useRef(viewingIds);
  viewingRef.current = viewingIds;
  // Switching tabs (or opening a file) brings the camera to that file, unless the selection is already in it.
  useEffect(() => {
    const ids = viewingRef.current;
    if (ids.length && !ids.includes(selectedIdRef.current ?? '')) setFlyTo({ id: ids[0], nonce: Date.now() });
  }, [viewingFile]);
  const overlay = useMemo<CodeGraphOverlay>(() => {
    const touched = new Set(wantRisk ? risk.data?.touched : []);
    const blast = new Set(wantRisk ? risk.data?.blast : []);
    // A traced A→B path wins over the review spotlight: it is the more specific question.
    const impact = reviewMode && !path.length
      ? impactDistance(adjacency, touched, focus === DIFF_FOCUS ? depth : undefined)
      : null;
    const spot = impact ? reviewSpotlight(graph?.links ?? [], touched, impact.keys()) : null;
    return {
      touched,
      blast,
      status: new Map(Object.entries(wantRisk ? risk.data?.status ?? {} : {})),
      impact,
      hot: new Set(hotSince.keys()),
      viewing: new Set(viewingIds),
      path: spot ? spot.nodes : new Set(path),
      pathLinks: spot ? spot.links : pathLinkKeys(path),
    };
  }, [wantRisk, risk.data, hotSince, path, reviewMode, graph, adjacency, focus, depth, viewingIds]);
  /** Impact view: hops from the focus, so the canvases lay the walk out as one ring per hop. */
  const rings = useMemo(() => {
    if (!focus || !graph) return null;
    const seeds = focusSeeds(graph.nodes, focus, risk.data?.touched ?? []);
    return seeds.size ? hopDistance(adjacency, seeds, direction ?? 'callers') : null;
  }, [focus, graph, adjacency, direction, risk.data]);
  /** Review maps the diff's whole upstream impact: every changed node seeds a callers walk. */
  const toggleReview = () => updateView(reviewMode
    ? { review: undefined, ...(focus === DIFF_FOCUS && { focus: undefined, depth: undefined, direction: undefined }) }
    : { review: '1', focus: DIFF_FOCUS, depth: String(IMPACT_HOPS), direction: 'callers', scope: undefined });
  // Coarse levels are one kind of node: the folder is what tells them apart, so it picks the color.
  const zoneColors = useMemo(
    () => (viewId === '2d' && level !== 'symbol' && graph ? zonePalette(graph.nodes) : null),
    [viewId, level, graph],
  );
  const sizeScale = useMemo(() => (graph ? metricScale(graph.nodes, sizeBy) : null), [graph, sizeBy]);
  // Review paints git status + impact: a metric ramp on top would be a second, competing code.
  const reviewPaint = overlay.impact !== null;
  const heat = useMemo(() => {
    const scale = !reviewPaint && graph && colorScale(graph.nodes, colorBy);
    return scale ? new Map(graph.nodes.map((n) => [n.id, scale(n)])) : null;
  }, [graph, colorBy, reviewPaint]);
  const zoneLegend = useMemo(
    () => (zoneColors ? [...zoneColors].filter(([, c]) => c !== ZONE_OTHER) : []),
    [zoneColors],
  );
  const results = useMemo(() => searchNodes(graph?.nodes ?? [], query), [graph, query]);
  const linkTypes = useMemo(() => {
    // Read off the unfiltered graph so a hidden type keeps its legend entry (to show it again).
    const present = new Set(fullGraph?.links.map((l) => l.type));
    return (Object.keys(LINK_LABELS) as Array<keyof typeof LINK_LABELS>).filter((t) => present.has(t));
  }, [fullGraph]);

  // Same query key as the code viewer's: the structure view and Ctrl+click share its outline.
  const activeSource = useCodeGraphSource(projectPath, activeTab?.file ?? null, rev);
  const activeOutline = activeSource.data?.outline;
  const changedFiles = useMemo(() => new Set(wantRisk ? risk.data?.files.map((f) => f.file) : []), [wantRisk, risk.data]);
  const changedRanges = useMemo(
    () => (activeTab && wantRisk ? risk.data?.files.find((f) => f.file === activeTab.file)?.ranges : undefined) ?? [],
    [activeTab, wantRisk, risk.data],
  );

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  // A new view starts unselected, except the first one: a shared link may carry `sel`.
  const firstViewRef = useRef(true);
  useEffect(() => {
    if (firstViewRef.current) { firstViewRef.current = false; return; }
    setSelectedId(null);
    setPathFrom(null);
  }, [viewKey]);
  useEffect(() => {
    if ((params.get('sel') ?? null) !== selectedId) update({ sel: selectedId ?? undefined }, { replace: true });
    // params is read, not tracked: only the selection writes `sel`.
  }, [selectedId, update]);
  // A filter (or a shared `sel` the graph does not draw) can drop the selection out of view.
  useEffect(() => {
    if (graph && selectedId && !nodesById.has(selectedId)) setSelectedId(null);
  }, [graph, nodesById, selectedId]);
  const toggleHidden = (key: HiddenKey) => {
    const next = new Set(hidden);
    if (!next.delete(key)) next.add(key);
    update({ hide: serializeHidden(next) });
  };
  useEffect(() => {
    setEditor((s) => ({ ...initialEditor, split: s.split }));
  }, [projectPath]);

  const showGraph = () => setEditor((s) => activateTab(s, GRAPH_TAB));
  /** Any change to what the graph draws brings the graph tab to the front. */
  const updateView = (patch: UrlPatch) => { update(patch); showGraph(); };

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) setAuxOpen(true);
  };
  const setSplit = () => {
    update({ split: editor.split ? undefined : '1' });
    setEditor(toggleSplit);
  };
  splitRef.current = setSplit;
  /** Split: clicking a node shows its code beside the graph (a preview tab), without moving the camera. */
  const selectFromGraph = (id: string | null) => {
    select(id);
    const n = id ? nodesById.get(id) : undefined;
    if (!editor.split || !n?.file) return;
    const range: [number, number] | null = n.startLine !== null ? [n.startLine, n.endLine ?? n.startLine] : null;
    setEditor((s) => openFileTab(s, { file: n.file!, range, nonce: Date.now() }, { preview: true }));
  };
  /** Split + link: the caret's symbol (or file) becomes the graph selection. */
  const followCaret = (line: number) => {
    if (!editor.split || !linked || !activeTab || !activeOutline) return;
    const id = nodeForCaret(level, activeTab.file, activeOutline, line);
    if (id && nodesById.has(id)) setSelectedId(id);
  };
  const jumpTo = (id: string) => {
    select(id);
    setFlyTo({ id, nonce: Date.now() });
    setQuery('');
    showGraph();
  };
  // Keyboard walk of the graph: ←/→ hop to the top caller/dep, ↑/↓ cycle its siblings,
  // P marks the start of an A→B trace, Esc clears the trace, then the selection.
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || !isCanvas) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="textbox"]'))) return;
    if (e.key === 'Escape') {
      if (pathFrom) setPathFrom(null);
      else select(null);
      return;
    }
    if (!selectedId) return;
    if (e.key === 'p' || e.key === 'P') {
      setPathFrom((from) => (from === selectedId ? null : selectedId));
      return;
    }
    const rank = new Map((graph?.nodes ?? []).map((n) => [n.id, n.rank]));
    const step = stepRef.current;
    let target: string | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const direction = e.key === 'ArrowRight' ? 'deps' : 'callers';
      target = neighbourAt(adjacency, rank, selectedId, direction, 0);
      stepRef.current = { id: selectedId, direction, i: 0 };
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && step.direction && step.id !== selectedId) {
      // Siblings: the other callers/deps of the node the last hop came from.
      const list = adjacency.get(step.id)?.[step.direction as 'callers' | 'deps'];
      const n = list?.size ?? 0;
      if (n) {
        step.i = (step.i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
        target = neighbourAt(adjacency, rank, step.id, step.direction as 'callers' | 'deps', step.i);
      }
    } else {
      return;
    }
    e.preventDefault();
    if (target) jumpTo(target);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  /** Bring a node into the graph selection if this view draws it; the editor follows regardless. */
  const reveal = (nodeId: string | null) => {
    if (!nodeId || !nodesById.has(nodeId)) return;
    setSelectedId(nodeId);
    setFlyTo({ id: nodeId, nonce: Date.now() });
  };
  const openFile = (file: string, range: [number, number] | null = null, symbolId: string | null = null, preview = true) => {
    setEditor((s) => openFileTab(s, { file, range, nonce: Date.now() }, { preview }));
    reveal(level === 'symbol' ? symbolId : nodeIdForFile(level, file));
  };
  const { history, inspectedId, choices, setChoices, here, dismissQuickOpen, goToSymbol, goToUsage, travel, goToDeclaration, resolveDeclaration, selectInFile } = useCodeNavigation({
    projectPath, rev, activeTab, activeOutline, openFile, setAuxOpen, setQuery, searchRef, splitRef, errorMessage,
  });

  const impactOf = (symbolId: string) => updateView({ level: 'symbol', focus: symbolId, depth: String(depth ?? 2), scope: undefined });
  const scopeTo = (dir: string | undefined) => updateView({ scope: dir, focus: undefined, depth: undefined, direction: undefined });
  /** Impact of a whole folder: every node under it seeds the walk, at the current level. */
  const folderImpact = (dir: string) => updateView({ focus: dir, depth: String(depth ?? 2), scope: undefined });

  if (projects.isLoading || !project) return <EmptyWorkbench loading={projects.isLoading} />;

  const scopeParts = scope ? scope.split('/') : [];
  const Renderer = renderer === '3d' ? CodeGraph3D : CodeGraph2D;
  const legendKinds = LEVEL_KINDS[level];
  const projectName = formatProjectName(project.projectPath);
  const stats = graphQuery.data?.stats;

  const activities: ActivityItem[] = [
    { id: 'files', icon: 'files', label: 'Explorer' },
    { id: 'structure', icon: 'list-tree', label: 'Structure' },
    { id: 'changes', icon: 'source-control', label: 'Changes', badge: risk.data?.files.length },
  ];

  const symbolItem = (h: CodeGraphSymbolRefDTO, from: NavLocation | null): QuickItem => ({
    key: h.id,
    icon: symbolIcon(h.kind),
    label: h.symbol,
    description: `${h.file}:${h.startLine}`,
    title: h.id,
    onPick: () => goToSymbol(h, from),
  });
  const quickSections: QuickSection[] = choices
    ? [{ label: choices.title, items: choices.items.map((h) => symbolItem(h, choices.from)) }]
    : [
      {
        label: 'In this graph',
        items: results.map((n) => ({
          key: n.id, icon: symbolIcon(n.kind), label: n.label, description: n.file ?? n.id, title: n.id, onPick: () => jumpTo(n.id),
        })),
      },
      {
        label: 'Symbols',
        items: symbolQuery ? (symbolHits.data ?? []).slice(0, SYMBOL_HITS_MAX).map((h) => symbolItem(h, here())) : [],
      },
    ];

  const titleBar = (
    <TitleBar
      start={(
        <VscodeSingleSelect
          className={wb.projectSelect}
          aria-label="Project"
          value={project.projectPath}
          onChange={(e) => update({ project: valueOf(e), level: undefined, scope: undefined, focus: undefined, depth: undefined, direction: undefined })}
        >
          {byRecency.map((p) => (
            <VscodeOption key={p.projectPath} value={p.projectPath} description={`${p.symbols.toLocaleString()} symbols`}>
              {formatProjectName(p.projectPath)}
            </VscodeOption>
          ))}
        </VscodeSingleSelect>
      )}
      center={(
        <QuickOpen
          ref={searchRef}
          placeholder={`Go to node or symbol in ${projectName} (Shift Shift)`}
          ariaLabel="Go to a graph node or a symbol"
          query={query}
          onQuery={(q) => { setQuery(q); setChoices(null); }}
          sections={quickSections}
          forceOpen={!!choices}
          onDismiss={dismissQuickOpen}
        />
      )}
      end={(
        <>
          <VscodeToolbarButton
            icon={sideView ? 'layout-sidebar-left' : 'layout-sidebar-left-off'}
            label="Toggle primary side bar"
            onClick={() => setSideView((v) => (v ? null : 'files'))}
          />
          <VscodeToolbarButton
            icon={auxOpen ? 'layout-panel' : 'layout-panel-off'}
            label="Toggle details panel"
            onClick={() => setAuxOpen((v) => !v)}
          />
        </>
      )}
    />
  );

  const sideBar = sideView === 'files' ? (
    <Pane title={`Explorer: ${projectName}`} loading={!files.data}>
      {files.data && (
        <FileTree
          files={files.data}
          changed={changedFiles}
          activeFile={activeTab?.file ?? null}
          onOpenFile={(f) => openFile(f)}
          onPinFile={(f) => openFile(f, null, null, false)}
          onScope={scopeTo}
          onImpact={folderImpact}
        />
      )}
    </Pane>
  ) : sideView === 'structure' ? (
    <Pane title={activeTab ? `Structure: ${activeTab.file.slice(activeTab.file.lastIndexOf('/') + 1)}` : 'Structure'} loading={!!activeTab && activeSource.isLoading}>
      {activeTab ? (
        activeOutline && <StructureView outline={activeOutline} activeId={inspectedId} onSelect={selectInFile} />
      ) : (
        <Placeholder icon="list-tree" title="No file open">Open a file to see its classes, functions and members.</Placeholder>
      )}
    </Pane>
  ) : sideView === 'changes' ? (
    <Pane
      title="Changes"
      loading={risk.isFetching}
      actions={(
        <>
        <VscodeToolbarButton
          icon="diff"
          label="Paint changes on the graph"
          toggleable
          checked={showRisk}
          onClick={() => setShowRisk((v) => !v)}
        />
        <VscodeToolbarButton
          icon="eye"
          label="Review mode: spotlight changes and their callers"
          toggleable
          checked={reviewMode}
          onClick={toggleReview}
        />
        </>
      )}
    >
      <ChangesPanel
        risk={risk.data}
        error={risk.isError ? errorMessage(risk.error) : null}
        worktree={worktree}
        onWorktree={setWorktree}
        onOpen={(file, range, symbolId) => { setDiffView(true); openFile(file, range, symbolId); }}
        onImpact={impactOf}
        activeFile={activeTab?.file ?? null}
        activeSymbol={inspectedId ?? (level === 'symbol' ? selectedId : null)}
      />
    </Pane>
  ) : null;

  const graphCrumbs = [
    { key: '', label: projectName, icon: 'repo', onClick: () => scopeTo(undefined) },
    ...scopeParts.map((part, i) => {
      const dir = scopeParts.slice(0, i + 1).join('/');
      return { key: dir, label: part, icon: 'folder', onClick: () => scopeTo(dir) };
    }),
  ];

  const graphEditor = (
    <>
      <Breadcrumbs crumbs={graphCrumbs}>
        {focus && (
          <>
            <span className={wb.crumb}><Codicon name="target" /> Impact of <b>{focus === DIFF_FOCUS ? `the diff · ${stats?.focusMatches ?? 0} changed` : nodesById.get(focus)?.label ?? focus}</b></span>
            <VscodeSingleSelect
              aria-label="Impact direction"
              value={direction}
              onChange={(e) => update({ direction: valueOf(e) })}
            >
              {DIRECTIONS.map((d) => <VscodeOption key={d.value} value={d.value}>{d.label}</VscodeOption>)}
            </VscodeSingleSelect>
            <VscodeSingleSelect
              aria-label="Impact depth"
              value={String(depth)}
              onChange={(e) => update({ depth: valueOf(e) })}
            >
              {DEPTHS.map((d) => <VscodeOption key={d} value={String(d)}>{`${d} hop${d > 1 ? 's' : ''}`}</VscodeOption>)}
            </VscodeSingleSelect>
            <VscodeToolbarButton icon="close" label="Clear impact view" onClick={() => update({ focus: undefined, depth: undefined, direction: undefined })} />
          </>
        )}
        {viewingFile && graph && (viewingIds.length ? (
          <button
            type="button"
            className={wb.crumb}
            title={`${viewingFile}: ${viewingIds.length} node${viewingIds.length === 1 ? '' : 's'} in this view (blue). Click to frame it.`}
            onClick={() => setFlyTo({ id: viewingIds[0], nonce: Date.now() })}
          >
            <span style={{ color: STATE_COLORS.viewing }}><Codicon name="eye" /></span> Viewing <b>{viewingFile.slice(viewingFile.lastIndexOf('/') + 1)}</b>
          </button>
        ) : (
          <span className={wb.crumb} title={`${viewingFile} is not drawn by this view (outside the impact walk or the node cap)`}>
            <Codicon name="eye-closed" /> <b>{viewingFile.slice(viewingFile.lastIndexOf('/') + 1)}</b> not in this view
            <VscodeToolbarButton icon="target" label="Map this file's impact" onClick={() => folderImpact(viewingFile)} />
          </span>
        ))}
      </Breadcrumbs>
      <div className={canvas.canvasWrap}>
        {graphQuery.isFetching && <ProgressLine />}
        {viewId === 'treemap' ? (
          <Suspense fallback={<ProgressLine />}>
            <TreemapView files={files.data} changed={changedFiles} activeFile={activeTab?.file ?? null} onOpenFile={(f) => openFile(f, null, null, true)} />
          </Suspense>
        ) : viewId === 'calls' ? (
          <Suspense fallback={<ProgressLine />}>
            <CallHierarchy
              project={project.projectPath}
              revision={rev}
              rootId={inspectedId ?? (level === 'symbol' ? selectedId : null)}
              onOpen={(s, line) => goToUsage(s, line)}
              errorMessage={errorMessage}
            />
          </Suspense>
        ) : graphQuery.isError ? (
          <Placeholder icon="error" title="Could not load the graph">{errorMessage(graphQuery.error)}</Placeholder>
        ) : !graph ? null : focus === DIFF_FOCUS && stats?.focusMatches === 0 ? (
          <Placeholder icon="diff" title="No indexed changes">
            The diff touches no indexed symbol at the {level} level (imports, comments or deleted files only). See the Changes panel.
          </Placeholder>
        ) : focus && stats?.focusMatches === 0 ? (
          <Placeholder icon="target" title="Impact target not found">
            <code>{focus}</code> is neither a node nor a folder at the {level} level. Pick a node in the graph or a
            folder in the explorer, or switch the level.
          </Placeholder>
        ) : graph.nodes.length === 0 ? (
          <Placeholder icon="search" title="Nothing to show">No indexed symbols match this scope or impact view.</Placeholder>
        ) : isCanvas ? (
          <Suspense fallback={<ProgressLine />}>
            <Renderer
              key={renderer}
              graph={graph}
              adjacency={adjacency}
              selectedId={selectedId}
              peekId={peekId && nodesById.has(peekId) ? peekId : null}
              overlay={overlay}
              flyTo={flyTo}
              fitKey={viewKey}
              fitAll={fitAll}
              sizeScale={sizeScale}
              heat={heat}
              rings={rings}
              {...(renderer === '2d' ? { zoneColors } : {})}
              onSelect={selectFromGraph}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<ProgressLine />}>
            {viewId === 'matrix' ? (
              <DependencyMatrix graph={graph} selectedId={selectedId} overlay={overlay} onSelect={selectFromGraph} />
            ) : viewId === 'layers' ? (
              <LayeredView graph={graph} selectedId={selectedId} overlay={overlay} onSelect={selectFromGraph} />
            ) : (
              <ClassDiagram graph={graph} selectedId={selectedId} overlay={overlay} onSelect={selectFromGraph} level={level} />
            )}
          </Suspense>
        )}

        {isCanvas && <ul className={canvas.legend} aria-label="Legend">
          {heat
            ? HEAT_COLORS.map((c, i) => (
              <li key={c}><i style={{ background: c }} />{i === 0 ? `Low ${METRIC_LABELS[colorBy].toLowerCase()}` : i === HEAT_COLORS.length - 1 ? 'High' : ''}</li>
            ))
            : zoneColors
            ? zoneLegend.map(([group, color]) => (
              <li key={group}><i style={{ background: color }} />{group}</li>
            ))
            : legendKinds.map((k) => (
              <li key={k}>
                <button type="button" className={legendToggleClass(hidden.has(k))} title={`${hidden.has(k) ? 'Show' : 'Hide'} ${KIND_LABELS[k].toLowerCase()} nodes`} onClick={() => toggleHidden(k)}>
                  <i style={{ background: KIND_COLORS[k] }} />{KIND_LABELS[k]}
                </button>
              </li>
            ))}
          {linkTypes.map((t) => (
            <li key={t}>
              <button type="button" className={legendToggleClass(hidden.has(t))} title={`${hidden.has(t) ? 'Show' : 'Hide'} ${LINK_LABELS[t].toLowerCase()} links`} onClick={() => toggleHidden(t)}>
                <i className={canvas.edgeSwatch} style={{ background: LINK_COLORS[t] }} />{LINK_LABELS[t]}
              </button>
            </li>
          ))}
          {path.length > 1 && <li><i style={{ background: STATE_COLORS.selected }} />Path · {path.length - 1} hops</li>}
          {live && !reviewPaint && <li><i style={{ background: STATE_COLORS.hot }} />Just reindexed</li>}
          {viewingIds.length > 0 && <li><i className={canvas.viewingSwatch} />Open file</li>}
          {overlay.impact ? <>
            <li><i style={{ background: STATE_COLORS.added }} />Added</li>
            <li><i style={{ background: STATE_COLORS.modified }} />Modified</li>
            <li title="Callers of changed code, fading with distance (deleted files have no node: see Changes)">
              {IMPACT_COLORS.map((c) => <i key={c} style={{ background: c }} />)}Impact 1→{IMPACT_HOPS} hops
            </li>
          </> : <>
            {wantRisk && <li><i style={{ background: STATE_COLORS.touched }} />Changed</li>}
            {wantRisk && <li><i style={{ background: STATE_COLORS.blast }} />Calls changed code</li>}
          </>}
          <li className={canvas.legendHint}>
            Click a kind or link to hide it · ←/→ walk · P trace · Bigger = {sizeBy === 'rank' ? 'more depended on' : `more ${METRIC_LABELS[sizeBy].toLowerCase()}`} · {renderer === '2d' ? 'hover to trace links' : 'zoom in for more names'}
          </li>
        </ul>}
      </div>
    </>
  );

  const editorGroup = (
    <>
      <EditorTabs
        state={editor}
        graphLabel={`Graph: ${LEVELS.find((l) => l.value === level)?.label}`}
        modified={changedFiles}
        onActivate={(id) => setEditor((s) => activateTab(s, id))}
        onClose={(file) => setEditor((s) => closeTab(s, file))}
        onPin={(file) => setEditor((s) => pinTab(s, file))}
        actions={(
          <>
            <VscodeToolbarButton
              icon="arrow-left"
              label={`Go back (Alt+←)${history.back.length ? '' : ': nothing to go back to'}`}
              onClick={() => travel('back')}
            />
            <VscodeToolbarButton
              icon="arrow-right"
              label={`Go forward (Alt+→)${history.forward.length ? '' : ': nothing to go forward to'}`}
              onClick={() => travel('forward')}
            />
            <VscodeToolbarButton
              icon="split-horizontal"
              label="Split editor: graph beside code (Ctrl+\\)"
              toggleable
              checked={editor.split}
              onClick={setSplit}
            />
            {editor.split && (
              <VscodeToolbarButton
                icon="link"
                label="Link the graph selection with the code caret"
                toggleable
                checked={linked}
                onClick={() => setLinked((v) => !v)}
              />
            )}
            {(editor.active === GRAPH_TAB || editor.split) && (
              <>
                {VIEWS.map((v) => (
                  <VscodeToolbarButton
                    key={v.id}
                    icon={v.icon}
                    label={v.label}
                    toggleable
                    checked={viewId === v.id}
                    onClick={() => update({ view: v.id === '2d' ? undefined : v.id })}
                  />
                ))}
                {isCanvas && <VscodeToolbarButton icon="screen-full" label="Frame the whole graph" onClick={() => setFitAll((n) => n + 1)} />}
              </>
            )}
          </>
        )}
      />
      <div className={wb.editorContent}>
        <section
          className={wb.layer}
          hidden={!editor.split && editor.active !== GRAPH_TAB}
          style={editor.split ? { right: 'auto', width: graphGroup.size } : undefined}
          aria-label="Code graph"
        >
          {graphEditor}
        </section>
        {editor.split && <Sash side="between" {...graphGroup} style={{ left: graphGroup.size }} />}
        {activeTab ? (
          <section className={wb.layer} style={editor.split ? { left: graphGroup.size } : undefined} aria-label={activeTab.file}>
            {diffView && changedFiles.has(activeTab.file) ? (
              <DiffViewer
                project={project.projectPath}
                file={activeTab.file}
                base={risk.data?.base}
                worktree={worktree}
                revision={rev}
                target={activeTab}
                errorMessage={errorMessage}
                onScope={scopeTo}
                onOpenSource={() => setDiffView(false)}
              />
            ) : (
              <CodeViewer
                project={project.projectPath}
                file={activeTab.file}
                revision={rev}
                target={activeTab}
                changedRanges={changedRanges}
                errorMessage={errorMessage}
                onScope={scopeTo}
                onSymbol={selectInFile}
                onCaret={followCaret}
                onGoToDeclaration={(name, line) => void goToDeclaration(name, line)}
              />
            )}
          </section>
        ) : editor.split && (
          <section className={wb.layer} style={{ left: graphGroup.size }} aria-label="Code">
            <Placeholder icon="file-code" title="No file open">Click a node in the graph or a file in the explorer to read its code here.</Placeholder>
          </section>
        )}
      </div>
    </>
  );

  // A symbol node at symbol level is a declaration: it can open the symbol view.
  const selectedRef: CodeGraphSymbolRefDTO | null = selected && level === 'symbol' && selected.file && selected.startLine !== null
    ? {
      id: selected.id,
      symbol: parseQualifiedId(selected.id)?.symbol ?? selected.label,
      kind: selected.kind,
      file: selected.file,
      startLine: selected.startLine,
      endLine: selected.endLine ?? selected.startLine,
    }
    : null;
  // While a file is open the pane follows code navigation; on the graph tab, the graph selection.
  const showSymbol = !!inspectedId && editor.active !== GRAPH_TAB;
  const hideAux = <VscodeToolbarButton icon="close" label="Hide details" onClick={() => setAuxOpen(false)} />;

  const auxBar = !auxOpen ? null : showSymbol ? (
    <Pane title="Symbol" actions={hideAux}>
      <SymbolDetails
        project={project.projectPath}
        id={inspectedId}
        revision={rev}
        errorMessage={errorMessage}
        onOpen={goToUsage}
        onInspect={(s) => goToSymbol(s)}
        onImpact={impactOf}
      />
    </Pane>
  ) : (
    <Pane title={selected ? 'Details' : 'Details: select a node, or Ctrl+click a name in code'} actions={hideAux}>
      {selected ? (
        <NodeInspector
          node={selected}
          level={level}
          neighbours={adjacency.get(selected.id)}
          nodesById={nodesById}
          nodes={graph?.nodes ?? []}
          edges={edges}
          overlay={overlay}
          onSelect={jumpTo}
          onFocus={(id) => updateView({ focus: id, depth: String(depth ?? 2), scope: undefined })}
          onDrill={(t) => updateView({ level: t.level, scope: t.scope, focus: undefined, depth: undefined, direction: undefined })}
          onViewCode={selected.file
            ? () => openFile(
              selected.file!,
              selected.startLine !== null ? [selected.startLine, selected.endLine ?? selected.startLine] : null,
              selected.id,
              false,
            )
            : undefined}
          onUsages={selectedRef ? () => goToSymbol(selectedRef, here(), false) : undefined}
          peek={{
            project: project.projectPath,
            revision: rev,
            resolve: resolveDeclaration,
            open: (f) => (f.range
              ? goToUsage({ id: f.id, symbol: f.label, kind: '', file: f.file, startLine: f.range[0], endLine: f.range[1] })
              : openFile(f.file, null, null, false)),
            highlight: setPeekId,
          }}
        />
      ) : (
        null
      )}
    </Pane>
  );

  const statusBar = (
    <StatusBar
      start={(
        <>
          <StatusItem variant="remote" icon="repo" title={project.projectPath}>{projectName}</StatusItem>
          {wantRisk && risk.data ? (
            <StatusItem icon="git-branch" title="Open the changes view" onClick={() => setSideView('changes')}>
              {risk.data.worktree ? 'worktree' : 'branch'} vs {risk.data.base} · {risk.data.tier} {risk.data.score.toFixed(2)}
            </StatusItem>
          ) : wantRisk && risk.isError ? (
            <StatusItem icon="error" variant="warn" title={errorMessage(risk.error)}>Branch risk unavailable</StatusItem>
          ) : null}
          {graph && stats && (
            <StatusItem icon="type-hierarchy-sub" title="Nodes drawn of the nodes in scope · links drawn">
              {graph.nodes.length.toLocaleString()}/{stats.totalNodes.toLocaleString()} · {graph.links.length.toLocaleString()} links
            </StatusItem>
          )}
          {stats && stats.unresolved > 0 && (
            <StatusItem icon="warning" title="Call sites the indexer could not attribute to a symbol (dynamic dispatch, external code). Not drawn.">
              {stats.unresolved.toLocaleString()} unresolved
            </StatusItem>
          )}
          {stats?.truncated && (
            <StatusItem
              icon="filter"
              variant="warn"
              title={(limit ?? DEFAULT_GRAPH_LIMIT) < MAX_GRAPH_LIMIT
                ? `Showing the top ${(limit ?? DEFAULT_GRAPH_LIMIT).toLocaleString()} of ${stats.totalNodes.toLocaleString()} by rank. Click to double the cap (slower), or drill in.`
                : 'At the hard cap: drill in or use the impact view'}
              onClick={(limit ?? DEFAULT_GRAPH_LIMIT) < MAX_GRAPH_LIMIT
                ? () => update({ limit: String(Math.min(MAX_GRAPH_LIMIT, (limit ?? DEFAULT_GRAPH_LIMIT) * 2)) })
                : undefined}
            >
              top {(limit ?? DEFAULT_GRAPH_LIMIT).toLocaleString()} of {stats.totalNodes.toLocaleString()}
            </StatusItem>
          )}
          {pathFrom && (
            <StatusItem
              icon="git-compare"
              title="Tracing from the marked node to the selection. Esc or click to stop."
              onClick={() => setPathFrom(null)}
            >
              {path.length > 1 ? `Path: ${path.length - 1} hops` : selectedId === pathFrom ? 'Path: select the end' : 'Path: not connected'}
            </StatusItem>
          )}
        </>
      )}
      end={(
        <>
          {LEVELS.map((l) => (
            <StatusItem
              key={l.value}
              variant={level === l.value ? 'active' : undefined}
              title={`Level of detail: ${l.label.toLowerCase()}`}
              onClick={() => updateView({ level: l.value, focus: undefined, depth: undefined, direction: undefined })}
            >
              {l.label}
            </StatusItem>
          ))}
          <StatusItem
            icon="symbol-ruler"
            title="Node size encodes this metric (click to cycle)"
            onClick={() => update({ size: cycle(SIZE_METRICS, sizeBy) === 'rank' ? undefined : cycle(SIZE_METRICS, sizeBy) })}
          >
            Size: {METRIC_LABELS[sizeBy]}
          </StatusItem>
          <StatusItem
            icon="symbol-color"
            title="Node color encodes this metric (click to cycle)"
            onClick={() => update({ color: cycle(COLOR_MODES, colorBy) === 'kind' ? undefined : cycle(COLOR_MODES, colorBy) })}
          >
            Color: {METRIC_LABELS[colorBy]}
          </StatusItem>
          <StatusItem
            icon="symbol-interface"
            pressed={exportedOnly}
            title="Show exported (public) nodes only"
            onClick={() => update({ exp: exportedOnly ? undefined : '1' })}
          >
            Public
          </StatusItem>
          <StatusItem icon="diff" pressed={showRisk} title="Paint the branch diff and its blast radius on the graph" onClick={() => setShowRisk((v) => !v)}>
            Overlay
          </StatusItem>
          <StatusItem icon="eye" pressed={reviewMode} title="Review mode: spotlight the diff and its blast radius, dim everything else" onClick={toggleReview}>
            Review
          </StatusItem>
          <StatusItem icon="broadcast" pressed={live} title="Follow the index as it changes" onClick={() => setLive((v) => !v)}>
            {live ? `Live${revision.dataUpdatedAt > 0 ? ` · ${formatRelativeTime(revision.dataUpdatedAt)}` : ''}` : 'Paused'}
          </StatusItem>
        </>
      )}
    />
  );

  return (
    <Workbench
      titleBar={titleBar}
      activityBar={<ActivityBar items={activities} active={sideView} onSelect={(id) => setSideView(id as SideView | null)} />}
      sideBar={sideBar}
      editor={editorGroup}
      panel={auxBar}
      panelCollapsed={!showSymbol && !selected}
      statusBar={statusBar}
    />
  );
}
