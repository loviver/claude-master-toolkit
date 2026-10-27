import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSessionGraph, useSessions } from '../../hooks/queries/useSessions';
import { useProjects } from '../../hooks/queries/useStats';
import { useFilters } from '../../lib/filters';
import { FilterBar, Sparkline } from '../../components/ui';
import {
  formatCompactCost, formatDuration, formatPercent, formatProjectName, formatRelativeTime, formatTokens, shortModel,
} from '../../lib/format';
import { MODEL_COLOR, PHASE_COLOR } from '../../lib/model-colors';
import type { SessionSummary } from '../../lib/types';
import { Codicon } from '../../shell/workbench/codicons';
import { Placeholder, ProgressLine } from '../../shell/workbench/Workbench';
import { costShare, modelMix, turnSeries } from './session-preview-model';
import styles from './SessionList.module.css';

/** Sessions as a flat, dense list; the row under the pointer (or focus) previews on the right. */
export function SessionList() {
  const { filters } = useFilters();
  const { data: projects } = useProjects(filters);
  const [q, setQ] = useState('');
  const [hideEmpty, setHideEmpty] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const { data, isLoading } = useSessions({ ...filters, q: q || undefined, limit: 200 });

  const rows = useMemo(
    () => (data ?? []).filter((s) => !hideEmpty || !s.isEmpty).sort((a, b) => b.lastActiveAt - a.lastActiveAt),
    [data, hideEmpty],
  );
  const maxCost = rows.reduce((max, s) => Math.max(max, s.costUsd), 0);
  const preview = rows.find((s) => s.id === previewId) ?? rows[0];

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Sessions</h1>
        <span className={styles.count}>{rows.length}</span>
        <label className={styles.search}>
          <Codicon name="search" />
          <input
            type="text"
            placeholder="Filter by project or branch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter sessions by project or branch"
          />
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Hide empty
        </label>
      </header>
      <FilterBar projects={projects ?? []} />

      <div className={styles.split}>
        <div className={styles.list} role="list" aria-busy={isLoading}>
          {isLoading && <ProgressLine />}
          {!isLoading && rows.length === 0 && (
            <Placeholder icon="inbox" title="No sessions">Adjust the filters or start a session.</Placeholder>
          )}
          {rows.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              costBar={costShare(s.costUsd, maxCost)}
              previewed={s.id === preview?.id}
              onPreview={() => setPreviewId(s.id)}
            />
          ))}
        </div>
        {preview && <SessionPreview session={preview} />}
      </div>
    </div>
  );
}

function SessionRow({ session: s, costBar, previewed, onPreview }: {
  session: SessionSummary;
  costBar: number;
  previewed: boolean;
  onPreview: () => void;
}) {
  const errors = (s.apiErrorTurns ?? 0) + (s.toolErrorCount ?? 0);
  return (
    <Link
      to={`/sessions/${s.id}`}
      role="listitem"
      className={`${styles.row} ${s.isEmpty ? styles.rowEmpty : ''}`}
      aria-current={previewed ? 'true' : undefined}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      title={s.projectPath}
    >
      <span className={styles.dot} style={{ background: MODEL_COLOR[s.primaryModelKey] }} title={s.primaryModel} />
      <span className={styles.name}>
        <span className={styles.project}>{formatProjectName(s.projectPath)}</span>
        {s.gitBranch && <span className={styles.branch}><Codicon name="git-branch" />{s.gitBranch}</span>}
      </span>
      <span className={styles.phase} style={{ color: PHASE_COLOR[s.dominantPhase] }}>{s.dominantPhase}</span>
      <span className={styles.metric} title="Turns · tool calls">
        <Codicon name="comment" />{s.turnCount}
        <Codicon name="tools" />{s.toolCount}
      </span>
      <span className={`${styles.metric} ${errors ? styles.errors : styles.faint}`} title="API + tool errors">
        <Codicon name="error" />{errors}
      </span>
      <span className={styles.metric} title="Cache hit rate">{formatPercent(s.cacheHitPct ?? 0)}</span>
      <span className={styles.cost} title={`$${s.costUsd.toFixed(4)}`}>
        <span className={styles.costBar} style={{ width: `${costBar * 100}%` }} />
        <span className={styles.costValue}>{formatCompactCost(s.costUsd)}</span>
      </span>
      <span className={styles.time}>{formatRelativeTime(s.lastActiveAt)}</span>
    </Link>
  );
}

function SessionPreview({ session: s }: { session: SessionSummary }) {
  const graph = useSessionGraph(s.id);
  const series = graph.data ? turnSeries(graph.data.nodes) : null;
  const mix = modelMix(s.models);
  return (
    <aside className={styles.preview} aria-label="Session preview">
      <header className={styles.previewHead}>
        <span className={styles.previewTitle}>{formatProjectName(s.projectPath)}</span>
        <span className={styles.previewSub}>
          {shortModel(s.primaryModel)}{s.gitBranch ? ` · ${s.gitBranch}` : ''} · {formatRelativeTime(s.lastActiveAt)}
        </span>
      </header>

      <section className={styles.previewBlock}>
        <h2 className={styles.previewLabel}>Tokens per turn</h2>
        {graph.isLoading && <ProgressLine />}
        {series && series.tokens.length > 1 ? (
          <>
            <Sparkline values={series.tokens} width={300} height={64} color={MODEL_COLOR[s.primaryModelKey]} />
            <div className={styles.phaseStrip} aria-label="Phase of each turn">
              {series.phases.map((p, i) => <span key={i} style={{ background: PHASE_COLOR[p] }} title={`Turn ${i + 1}: ${p}`} />)}
            </div>
          </>
        ) : !graph.isLoading && <p className={styles.faint}>Not enough turns to chart.</p>}
      </section>

      {mix.length > 0 && (
        <section className={styles.previewBlock}>
          <h2 className={styles.previewLabel}>Models</h2>
          <div className={styles.mixBar}>
            {mix.map((m) => <span key={m.model} style={{ flex: `${m.share} 1 0`, background: MODEL_COLOR[m.modelKey] }} title={`${m.model}: ${formatPercent(m.share * 100)}`} />)}
          </div>
          <ul className={styles.mixLegend}>
            {mix.map((m) => (
              <li key={m.model}><span className={styles.dot} style={{ background: MODEL_COLOR[m.modelKey] }} />{shortModel(m.model)} <span className={styles.faint}>{formatPercent(m.share * 100)}</span></li>
            ))}
          </ul>
        </section>
      )}

      <dl className={styles.stats}>
        <dt>Cost</dt><dd>{formatCompactCost(s.costUsd)}</dd>
        <dt>Turns</dt><dd>{s.turnCount}{s.sidechainTurns ? ` (+${s.sidechainTurns} side)` : ''}</dd>
        <dt>Tools</dt><dd>{s.toolCount}</dd>
        <dt>Input</dt><dd>{formatTokens(s.tokens.inputTokens)}</dd>
        <dt>Output</dt><dd>{formatTokens(s.tokens.outputTokens)}</dd>
        <dt>Cache</dt><dd>{formatPercent(s.cacheHitPct ?? 0)}</dd>
        {s.durationMs != null && <><dt>Duration</dt><dd>{formatDuration(s.durationMs)}</dd></>}
        {!!s.thinkingTurns && <><dt>Thinking</dt><dd>{s.thinkingTurns} turns</dd></>}
      </dl>

      <Link to={`/sessions/${s.id}`} className={styles.open}>
        <Codicon name="go-to-file" />Open session
      </Link>
    </aside>
  );
}
