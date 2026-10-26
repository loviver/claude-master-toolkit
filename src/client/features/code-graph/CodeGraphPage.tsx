import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Orbit, Radio, ShieldAlert, X } from 'lucide-react';
import { Button, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '../../components/ui';
import { formatProjectName, formatRelativeTime } from '../../lib/format';
import type { CodeGraphLevel } from '../../lib/types';
import {
  useCodeGraph,
  useCodeGraphProjects,
  useCodeGraphRevision,
  useCodeGraphRisk,
} from '../../hooks/queries/useCodeGraph';
import { ApiError } from '../../hooks/queries/api';
import {
  KIND_COLORS,
  KIND_LABELS,
  STATE_COLORS,
  buildAdjacency,
  defaultLevel,
  mergeGraph,
  searchNodes,
  type KindCategory,
  type RenderGraph,
} from './graph-model';
import { CodeGraph3D, type CodeGraphOverlay } from './CodeGraph3D';
import { NodeInspector } from './NodeInspector';
import styles from './CodeGraph.module.css';

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
const DEPTHS = [1, 2, 3, 4].map((d) => ({ value: String(d), label: `${d} hop${d > 1 ? 's' : ''}` }));
/** How long a reindexed node stays highlighted as "hot". */
const HOT_MS = 60_000;
const HOT_TICK_MS = 5_000;

type UrlPatch = Partial<Record<'project' | 'level' | 'scope' | 'focus' | 'depth', string | undefined>>;

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
  const scope = params.get('scope') ?? undefined;
  const focus = params.get('focus') ?? undefined;
  const depth = focus ? Number(params.get('depth') ?? 2) : undefined;
  const viewKey = JSON.stringify([projectPath, level, scope, focus, depth]);

  const [live, setLive] = useState(true);
  const [showRisk, setShowRisk] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [flyTo, setFlyTo] = useState<{ id: string; nonce: number } | null>(null);

  const revision = useCodeGraphRevision(projectPath, live);
  const rev = revision.data?.revision;
  const graphQuery = useCodeGraph({ project: projectPath, level, scope, focus, depth }, rev);
  const risk = useCodeGraphRisk(projectPath, level, rev, showRisk);

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
    touched: new Set(showRisk ? risk.data?.touched : []),
    blast: new Set(showRisk ? risk.data?.blast : []),
    hot: new Set(hotSince.keys()),
  }), [showRisk, risk.data, hotSince]);
  const results = useMemo(() => searchNodes(graph?.nodes ?? [], query), [graph, query]);

  const selected = selectedId ? nodesById.get(selectedId) : undefined;
  useEffect(() => setSelectedId(null), [viewKey]);

  const select = useCallback((id: string | null) => setSelectedId(id), []);
  const jumpTo = (id: string) => {
    setSelectedId(id);
    setFlyTo({ id, nonce: Date.now() });
    setQuery('');
  };

  if (projects.isLoading) return <Skeleton height={640} radius="md" />;
  if (!project) {
    return (
      <div className={styles.page}>
        <PageHeader icon={Orbit} title="Code Graph" description="Live 3D map of the AST index" />
        <Card>
          <EmptyState
            icon={Orbit}
            title="No indexed projects yet"
            description="Run `ctk index build` inside a repository, then come back: its modules, files and symbols appear here and update as the index changes."
          />
        </Card>
      </div>
    );
  }

  const scopeParts = scope ? scope.split('/') : [];
  const legendKinds = LEVEL_KINDS[level];

  return (
    <div className={styles.page}>
      <PageHeader
        icon={Orbit}
        title="Code Graph"
        description="Live 3D map of the AST index: the same graph ctk's agent tools query"
      />

      <div className={styles.toolbar}>
        <div className={styles.projectPick}>
          <Select
            aria-label="Project"
            value={project.projectPath}
            onChange={(e) => update({ project: e.target.value, level: undefined, scope: undefined, focus: undefined, depth: undefined })}
            options={byRecency.map((p) => ({
              value: p.projectPath,
              label: `${formatProjectName(p.projectPath)} · ${p.symbols.toLocaleString()} symbols`,
            }))}
          />
        </div>

        <div className={styles.segmented} role="group" aria-label="Level of detail">
          {LEVELS.map((l) => (
            <button
              key={l.value}
              type="button"
              aria-pressed={level === l.value}
              className={styles.segment}
              onClick={() => update({ level: l.value, focus: undefined, depth: undefined })}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className={styles.search}>
          <Input
            type="search"
            placeholder="Find in view…"
            aria-label="Find a node in the current view"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) jumpTo(results[0].id); }}
          />
          {results.length > 0 && (
            <ul className={styles.results} role="listbox">
              {results.map((n) => (
                <li key={n.id}>
                  <button type="button" className={styles.result} onClick={() => jumpTo(n.id)} title={n.id}>
                    {n.label}<span>{n.file ?? n.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className={styles.toggles}>
          <Button size="sm" variant={live ? 'default' : 'ghost'} aria-pressed={live} onClick={() => setLive((v) => !v)}>
            <Radio size={14} className={live ? styles.liveDot : undefined} /> Live
          </Button>
          <Button size="sm" variant={showRisk ? 'default' : 'ghost'} aria-pressed={showRisk} onClick={() => setShowRisk((v) => !v)}>
            <ShieldAlert size={14} /> Branch risk
          </Button>
        </div>
      </div>

      <div className={styles.contextBar}>
        <nav className={styles.crumbs} aria-label="Scope">
          <button type="button" onClick={() => update({ scope: undefined, focus: undefined, depth: undefined })}>
            {formatProjectName(project.projectPath)}
          </button>
          {scopeParts.map((part, i) => (
            <span key={i}>
              <span className={styles.crumbSep}>/</span>
              <button
                type="button"
                onClick={() => update({ scope: scopeParts.slice(0, i + 1).join('/'), focus: undefined, depth: undefined })}
              >
                {part}
              </button>
            </span>
          ))}
        </nav>

        {focus && (
          <div className={styles.focusChip}>
            Impact of <code>{nodesById.get(focus)?.label ?? focus}</code>
            <select
              aria-label="Impact depth"
              value={String(depth)}
              onChange={(e) => update({ depth: e.target.value })}
            >
              {DEPTHS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <button type="button" aria-label="Clear impact view" onClick={() => update({ focus: undefined, depth: undefined })}>
              <X size={12} />
            </button>
          </div>
        )}

        {graph && graphQuery.data && (
          <p className={styles.stats}>
            {graph.nodes.length.toLocaleString()} of {graphQuery.data.stats.totalNodes.toLocaleString()} nodes
            {' · '}{graph.links.length.toLocaleString()} links
            {graphQuery.data.stats.unresolved > 0 && (
              <span title="Call sites the indexer could not attribute to a symbol (dynamic dispatch, external code). Not drawn.">
                {' · '}{graphQuery.data.stats.unresolved.toLocaleString()} unresolved edges
              </span>
            )}
            {graphQuery.data.stats.truncated && (
              <span className={styles.warn}> · showing top-ranked only: drill in or use the impact view</span>
            )}
            {revision.dataUpdatedAt > 0 && live && <> · checked {formatRelativeTime(revision.dataUpdatedAt)}</>}
          </p>
        )}
      </div>

      {showRisk && risk.isError && (
        <p className={styles.notice} role="status">Branch risk unavailable: {errorMessage(risk.error)}</p>
      )}
      {showRisk && risk.data && (
        <p className={styles.notice} role="status">
          Branch vs <code>{risk.data.base}</code>: <strong>{risk.data.tier}</strong> (score {risk.data.score.toFixed(2)})
          {' · '}{risk.data.touched.length} changed · {risk.data.blast.length} in blast radius at this level
        </p>
      )}

      <div className={`${styles.stage} ${selected ? styles.withInspector : ''}`}>
        <div className={styles.canvasWrap}>
          {graphQuery.isError ? (
            <EmptyState icon={Orbit} title="Could not load the graph" description={errorMessage(graphQuery.error)} />
          ) : !graph ? (
            <Skeleton height="100%" radius="md" />
          ) : graph.nodes.length === 0 ? (
            <EmptyState icon={Orbit} title="Nothing to show" description="No indexed symbols match this scope or impact view." />
          ) : (
            <CodeGraph3D
              graph={graph}
              adjacency={adjacency}
              selectedId={selectedId}
              overlay={overlay}
              flyTo={flyTo}
              fitKey={viewKey}
              onSelect={select}
            />
          )}

          <ul className={styles.legend} aria-label="Legend">
            {legendKinds.map((k) => (
              <li key={k}><i style={{ background: KIND_COLORS[k] }} />{KIND_LABELS[k]}</li>
            ))}
            {live && <li><i style={{ background: STATE_COLORS.hot }} />Just reindexed</li>}
            {showRisk && <li><i style={{ background: STATE_COLORS.touched }} />Changed on branch</li>}
            {showRisk && <li><i style={{ background: STATE_COLORS.blast }} />Blast radius</li>}
          </ul>
        </div>

        {selected && (
          <NodeInspector
            node={selected}
            level={level}
            neighbours={adjacency.get(selected.id)}
            nodesById={nodesById}
            touched={overlay.touched.has(selected.id)}
            blast={overlay.blast.has(selected.id)}
            onSelect={jumpTo}
            onFocus={(id) => update({ focus: id, depth: String(depth ?? 2) })}
            onDrill={(t) => update({ level: t.level, scope: t.scope, focus: undefined, depth: undefined })}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
