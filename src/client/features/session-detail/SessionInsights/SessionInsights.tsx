import { AlertTriangle, Archive, Scissors, Timer } from 'lucide-react';
import type { Phase } from '../../../lib/types';
import { MetricTile } from '../../../components/ui';
import { formatCost, formatDuration, formatPercent } from '../../../lib/format';
import type { SessionInsights } from '../session-insights';
import styles from './SessionInsights.module.css';

interface Props {
  insights: SessionInsights;
}

const PHASE_COLOR: Record<Phase, string> = {
  exploration: 'var(--chart-2)',
  implementation: 'var(--chart-3)',
  testing: 'var(--chart-4)',
  unknown: 'var(--text-muted)',
};

/** Signals that something went wrong or got expensive: errors, compactions, truncations, latency. */
export function HealthStrip({ insights }: Props) {
  const { toolErrors, apiErrors, compactions, maxTokensStops, slowest, p50DurationMs } = insights;
  const errors = toolErrors + apiErrors;
  return (
    <div className={styles.health}>
      <MetricTile
        icon={AlertTriangle}
        tone={errors > 0 ? 'red' : 'green'}
        label="Errors"
        value={errors}
        hint={`${toolErrors} tool · ${apiErrors} API`}
      />
      <MetricTile
        icon={Archive}
        tone={compactions > 0 ? 'amber' : 'green'}
        label="Compactions"
        value={compactions}
        hint={compactions > 0 ? 'context was summarized' : 'context never compacted'}
      />
      <MetricTile
        icon={Scissors}
        tone={maxTokensStops > 0 ? 'red' : 'green'}
        label="Truncated"
        value={maxTokensStops}
        hint="turns stopped at max_tokens"
      />
      <MetricTile
        icon={Timer}
        tone="cyan"
        label="Slowest turn"
        value={slowest ? formatDuration(slowest.durationMs) : '—'}
        hint={
          slowest
            ? `turn ${slowest.turnIdx + 1} · p50 ${p50DurationMs != null ? formatDuration(p50DurationMs) : '—'}`
            : 'no latency recorded'
        }
      />
    </div>
  );
}

/** What the session spent its turns on: tools, phases, sub-agents. */
export function ActivityPanel({ insights }: Props) {
  const { topTools, phases, agents, thinkingPct, filesChanged, hooks, webCalls } = insights;
  const maxTool = topTools[0]?.count ?? 0;
  return (
    <div className={styles.activity}>
      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Top tools</h3>
        {topTools.length === 0 ? (
          <p className={styles.empty}>No tool calls</p>
        ) : (
          <ul className={styles.bars}>
            {topTools.map((t) => (
              <li key={t.name} className={styles.barRow}>
                <span className={styles.barLabel}>{t.name}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} style={{ width: `${(t.count / maxTool) * 100}%` }} />
                </span>
                <span className={styles.barValue}>{t.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Phases</h3>
        <div className={styles.phaseBar}>
          {phases.map((p) => (
            <span
              key={p.phase}
              title={`${p.phase}: ${p.turns} turns`}
              style={{ width: `${p.pct}%`, background: PHASE_COLOR[p.phase] }}
            />
          ))}
        </div>
        <ul className={styles.phaseList}>
          {phases.map((p) => (
            <li key={p.phase}>
              <span className={styles.swatch} style={{ background: PHASE_COLOR[p.phase] }} />
              {p.phase}
              <span className={styles.muted}>{formatPercent(p.pct)}</span>
            </li>
          ))}
        </ul>

        <h3 className={styles.blockTitle}>Sub-agents</h3>
        {agents.length === 0 ? (
          <p className={styles.empty}>No sub-agents spawned</p>
        ) : (
          <ul className={styles.kv}>
            {agents.map((a) => (
              <li key={a.role}>
                <span>{a.role}</span>
                <span className={styles.muted}>{a.turns} turns · {formatCost(a.costUsd)}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className={styles.blockTitle}>Activity</h3>
        <ul className={styles.kv}>
          <li><span>Thinking</span><span className={styles.muted}>{formatPercent(thinkingPct)} of turns</span></li>
          <li><span>Files touched</span><span className={styles.muted}>{filesChanged}</span></li>
          <li><span>Hook runs</span><span className={styles.muted}>{hooks}</span></li>
          <li><span>Web search / fetch</span><span className={styles.muted}>{webCalls}</span></li>
        </ul>
      </div>
    </div>
  );
}
