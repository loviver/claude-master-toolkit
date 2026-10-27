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
import { ApiError } from '../../hooks/queries/api';
import {
  KIND_COLORS,
  KIND_LABELS,
  LINK_COLORS,
  LINK_LABELS,
  STATE_COLORS,
  ZONE_OTHER,
  buildAdjacency,
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
import { NodeInspector } from './NodeInspector';
import { FileTree } from './FileTree';
import { CodeViewer } from './CodeViewer';
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
import { nodeIdForFile } from './explorer-model';
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
const HOT_MS = 60_000;
const HOT_TICK_MS = 5_000;

type UrlPatch = Partial<Record<'project' | 'level' | 'scope' | 'focus' | 'depth' | 'direction' | 'view' | 'split', string | undefined>>;
type SideView = 'files' | 'structure' | 'changes';
/** Symbol hits listed under the graph's own matches. */
const SYMBOL_HITS_MAX = 30;

/** View state lives in the URL so a view can be bookmarked, shared, or linked to by an agent. */
function useGraphParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback((patch: UrlPatch) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === '') next.delete(k);
        else next.set(k, v);
      }
      return next;
    });
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
  const renderer = viewId === '3d' ? '3d' : '2d';
  const isCanvas = viewId === '2d' || viewId === '3d';
  const viewKey = JSON.stringify([projectPath, level, scope, focus, depth, direction]);

  const [live, setLive] = useState(true);
  const [showRisk, setShowRisk] = useState(false);
  const [worktree, setWorktree] = useState(true);
  const [sideView, setSideView] = useState<SideView | null>('files');
  const [auxOpen, setAuxOpen] = useState(true);
  const [editor, setEditor] = useState<EditorState>(() => (params.get('split') === '1' ? toggleSplit(initialEditor) : initialEditor));
  const [linked, setLinked] = useState(true);
  const graphGroup = useSash(560, 280, 1400);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [flyTo, setFlyTo] = useState<{ id: string; nonce: number } | null>(null);
  const [fitAll, setFitAll] = useState(0);
  const searchRef = useRef<QuickOpenHandle>(null);
  const splitRef = useRef(() => {});

  const revision = useCodeGraphRevision(projectPath, live);
  const rev = revision.data?.revision;
  const graphQuery = useCodeGraph({ project: projectPath, level, scope, focus, depth, direction }, rev);
  // The changes view needs the diff even with the overlay off; the overlay paints what it lists.
  const wantRisk = showRisk || sideView === 'changes';
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
  const graph = view?.key === viewKey ? view.graph : null;

  // Reindexed nodes glow for HOT_MS, then fade back to their kind color.
  const [hotSince, setHotSince] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    if (!graph?.changed.length) return;
    const now = Date.now();
    setHotSince((prev) => new Map([...prev, ...graph.changed.map((id) => [id, now] as const)]));
  }, [graph]);
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
  const overlay = useMemo<CodeGraphOverlay>(() => ({
    touched: new Set(wantRisk ? risk.data?.touched : []),
    blast: new Set(wantRisk ? risk.data?.blast : []),
    hot: new Set(hotSince.keys()),
  }), [wantRisk, risk.data, hotSince]);
  // Coarse levels are one kind of node: the folder is what tells them apart, so it picks the color.
  const zoneColors = useMemo(
    () => (viewId === '2d' && level !== 'symbol' && graph ? zonePalette(graph.nodes) : null),
    [viewId, level, graph],
  );
  const zoneLegend = useMemo(
    () => (zoneColors ? [...zoneColors].filter(([, c]) => c !== ZONE_OTHER) : []),
    [zoneColors],
  );
  const results = useMemo(() => searchNodes(graph?.nodes ?? [], query), [graph, query]);
  const linkTypes = useMemo(() => {
    const present = new Set(graph?.links.map((l) => l.type));
    return (Object.keys(LINK_LABELS) as Array<keyof typeof LINK_LABELS>).filter((t) => present.has(t));
  }, [graph]);

  const activeTab = activeFileTab(editor);
  // Same query key as the code viewer's: the structure view and Ctrl+click share its outline.
  const activeSource = useCodeGraphSource(projectPath, activeTab?.file ?? null, rev);
  const activeOutline = activeSource.data?.outline;
  const changedFiles = useMemo(() => new Set(wantRisk ? risk.data?.files.map((f) => f.file) : []), [wantRisk, risk.data]);
  const changedRanges = useMemo(
    () => (activeTab && wantRisk ? risk.data?.files.find((f) => f.file === activeTab.file)?.ranges : undefined) ?? [],
    [activeTab, wantRisk, risk.data],
  );

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  useEffect(() => setSelectedId(null), [viewKey]);
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
  const { history, inspectedId, choices, setChoices, here, dismissQuickOpen, goToSymbol, goToUsage, travel, goToDeclaration, selectInFile } = useCodeNavigation({
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
            icon={auxOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off'}
            label="Toggle details side bar"
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
        <VscodeToolbarButton
          icon="diff"
          label="Paint changes on the graph"
          toggleable
          checked={showRisk}
          onClick={() => setShowRisk((v) => !v)}
        />
      )}
    >
      <ChangesPanel
        risk={risk.data}
        error={risk.isError ? errorMessage(risk.error) : null}
        worktree={worktree}
        onWorktree={setWorktree}
        onOpen={(file, range, symbolId) => openFile(file, range, symbolId)}
        onImpact={impactOf}
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
            <span className={wb.crumb}><Codicon name="target" /> Impact of <b>{nodesById.get(focus)?.label ?? focus}</b></span>
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
        ) : !graph ? null : focus && stats?.focusMatches === 0 ? (
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
              overlay={overlay}
              flyTo={flyTo}
              fitKey={viewKey}
              fitAll={fitAll}
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
          {zoneColors
            ? zoneLegend.map(([group, color]) => (
              <li key={group}><i style={{ background: color }} />{group}</li>
            ))
            : legendKinds.map((k) => (
              <li key={k}><i style={{ background: KIND_COLORS[k] }} />{KIND_LABELS[k]}</li>
            ))}
          {linkTypes.map((t) => (
            <li key={t}><i className={canvas.edgeSwatch} style={{ background: LINK_COLORS[t] }} />{LINK_LABELS[t]}</li>
          ))}
          {live && <li><i style={{ background: STATE_COLORS.hot }} />Just reindexed</li>}
          {wantRisk && <li><i style={{ background: STATE_COLORS.touched }} />Changed</li>}
          {wantRisk && <li><i style={{ background: STATE_COLORS.blast }} />Calls changed code</li>}
          <li className={canvas.legendHint}>
            Bigger = more depended on · {renderer === '2d' ? 'hover to trace links' : 'zoom in for more names'}
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
    <Pane title="Details" actions={hideAux}>
      {selected ? (
        <NodeInspector
          node={selected}
          level={level}
          neighbours={adjacency.get(selected.id)}
          nodesById={nodesById}
          touched={overlay.touched.has(selected.id)}
          blast={overlay.blast.has(selected.id)}
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
        />
      ) : (
        <Placeholder icon="info" title="Nothing selected">
          Click a node in the graph to see what it depends on and what uses it. In code, Ctrl+click a name to go
          to its declaration, or a declaration to list its usages.
        </Placeholder>
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
            <StatusItem icon="filter" variant="warn" title="Showing top-ranked only: drill in or use the impact view">top-ranked only</StatusItem>
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
          <StatusItem icon="diff" pressed={showRisk} title="Paint the branch diff and its blast radius on the graph" onClick={() => setShowRisk((v) => !v)}>
            Overlay
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
      auxBar={auxBar}
      statusBar={statusBar}
    />
  );
}
