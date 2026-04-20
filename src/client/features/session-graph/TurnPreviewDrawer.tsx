import { useEffect, useMemo, useState } from 'react';
import {
  Drawer, Button, Badge, Skeleton, EmptyState,
  CopyableValue, ExpandablePre,
  modelKeyBadgeVariant, phaseBadgeVariant,
} from '../../components/ui';
import {
  AlertTriangle, ArrowDown, ArrowUp, Bot, ChevronLeft, ChevronRight,
  Clock, Database, FileQuestion, Folder, GitBranch, Hash, Image as ImageIcon,
  Lock, Maximize2, Minimize2, Package, Tag,
} from 'lucide-react';
import { useTurnContent } from '../../hooks/queries/useSessions';
import type { SessionGraphNode, TurnPairDTO } from '../../lib/types';
import styles from './TurnPreviewDrawer.module.css';

interface Props {
  sessionId: string;
  turns: SessionGraphNode[];
  selectedId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}

const WIDTH_COMPACT = 460;
const WIDTH_WIDE = 680;

export function TurnPreviewDrawer({ sessionId, turns, selectedId, open, onSelect, onClose }: Props) {
  const [wide, setWide] = useState(false);

  const { turn, prev, next, idx } = useMemo(() => {
    if (!selectedId) return { turn: null, prev: null, next: null, idx: -1 };
    const i = turns.findIndex((t) => t.id === selectedId);
    return {
      turn: i >= 0 ? turns[i] : null,
      prev: i > 0 ? turns[i - 1] : null,
      next: i >= 0 && i < turns.length - 1 ? turns[i + 1] : null,
      idx: i,
    };
  }, [selectedId, turns]);

  const eventId = turn ? Number(turn.id) : null;
  const { data, isLoading, error } = useTurnContent(sessionId, eventId);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === 'ArrowLeft' && prev) { e.preventDefault(); onSelect(prev.id); }
      else if (e.key === 'ArrowRight' && next) { e.preventDefault(); onSelect(next.id); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, prev, next, onSelect]);

  const title = turn ? `Turn ${turn.turnIdx + 1}` : 'Turn';

  const headerActions = (
    <button
      className={styles.widthToggle}
      onClick={() => setWide((v) => !v)}
      aria-label={wide ? 'Shrink drawer' : 'Expand drawer'}
      title={wide ? 'Shrink' : 'Expand'}
    >
      {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={title}
      side="right"
      width={wide ? WIDTH_WIDE : WIDTH_COMPACT}
      headerActions={headerActions}
      footer={
        turn && (
          <>
            <Button size="sm" variant="ghost" disabled={!prev} onClick={() => prev && onSelect(prev.id)} title="Previous (←)">
              <ChevronLeft size={14} /> Prev
            </Button>
            <span className={styles.idxLabel}>{idx + 1} / {turns.length}</span>
            <Button size="sm" variant="ghost" disabled={!next} onClick={() => next && onSelect(next.id)} title="Next (→)">
              Next <ChevronRight size={14} />
            </Button>
          </>
        )
      }
    >
      {isLoading && <Skeleton height={200} radius="md" />}
      {error && (
        <EmptyState
          icon={FileQuestion}
          title="No content saved"
          description="This turn has no persisted content payload."
        />
      )}
      {data && <TurnPairContent pair={data} turn={turn} />}
    </Drawer>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────

function Hero({ turn, agentRole }: { turn: SessionGraphNode | null; agentRole: string | null }) {
  if (!turn) return null;
  return (
    <div className={styles.hero}>
      <div className={styles.heroBadges}>
        <Badge variant={modelKeyBadgeVariant(turn.modelKey)}>{turn.modelKey}</Badge>
        {agentRole && (
          <span title="Sub-agent role">
            <Badge variant="default">
              <Bot size={11} style={{ marginRight: 3, verticalAlign: '-2px' }} />
              {agentRole}
            </Badge>
          </span>
        )}
        <Badge variant={phaseBadgeVariant(turn.phase)}>{turn.phase}</Badge>
        {turn.stopReason && <Badge variant="info">{turn.stopReason}</Badge>}
      </div>
      <div className={styles.heroMeta}>
        {turn.tools.length > 0 && <span>{turn.tools.length} tool{turn.tools.length === 1 ? '' : 's'}</span>}
        {typeof turn.durationMs === 'number' && turn.durationMs > 0 && (
          <span className={styles.heroMetaItem}>
            <Clock size={11} /> {fmtDuration(turn.durationMs)}
          </span>
        )}
      </div>
    </div>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

// ─── Stats grid ───────────────────────────────────────────────────────

function StatsGrid({ turn }: { turn: SessionGraphNode }) {
  const cells: Array<{ label: string; value: string; Icon: React.ComponentType<{ size?: number }> }> = [
    { label: 'Input', value: turn.inputTokens.toLocaleString(), Icon: ArrowDown },
    { label: 'Output', value: turn.outputTokens.toLocaleString(), Icon: ArrowUp },
    { label: 'Cache', value: `${turn.cacheHitPct}%`, Icon: Database },
    { label: 'Cost', value: turn.costUsd > 0 ? `$${turn.costUsd.toFixed(4)}` : '—', Icon: Tag },
  ];
  return (
    <div className={styles.statsGrid}>
      {cells.map((c) => (
        <div key={c.label} className={styles.statCell}>
          <div className={styles.statLabel}>
            <c.Icon size={10} /> {c.label}
          </div>
          <div className={styles.statValue}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Metadata (collapsible) ───────────────────────────────────────────

const META_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  slug: Tag,
  permissionMode: Lock,
  gitBranch: GitBranch,
  cwd: Folder,
  requestId: Hash,
  promptId: Hash,
  messageId: Hash,
  parentEventId: Hash,
  serviceTier: Package,
  speed: Clock,
};

function MetaChip({ name, value, expandable }: { name: string; value: string; expandable?: boolean }) {
  const Icon = META_ICONS[name] ?? Hash;
  return (
    <span className={styles.metaChip} title={name}>
      <Icon size={10} />
      <span className={styles.metaChipName}>{name}</span>
      <CopyableValue value={value} maxChars={24} mono expandable={expandable} label={name} />
    </span>
  );
}

function MetadataBlock({ ae, turn }: { ae: TurnPairDTO['assistantEvent']; turn: SessionGraphNode | null }) {
  const rawEntries: Array<{ name: string; value: string; expandable?: boolean } | null> = [
    ae.slug ? { name: 'slug', value: ae.slug } : null,
    ae.permissionMode ? { name: 'permissionMode', value: ae.permissionMode } : null,
    ae.gitBranch ? { name: 'gitBranch', value: ae.gitBranch } : null,
    ae.cwd ? { name: 'cwd', value: ae.cwd, expandable: true } : null,
    ae.requestId ? { name: 'requestId', value: ae.requestId } : null,
    ae.promptId ? { name: 'promptId', value: ae.promptId } : null,
    typeof ae.parentEventId === 'number' ? { name: 'parentEventId', value: String(ae.parentEventId) } : null,
    turn?.requestId && !ae.requestId ? { name: 'requestId', value: turn.requestId } : null,
    turn?.messageId ? { name: 'messageId', value: turn.messageId } : null,
    turn?.serviceTier ? { name: 'serviceTier', value: turn.serviceTier } : null,
    turn?.speed ? { name: 'speed', value: turn.speed } : null,
  ];
  const entries = rawEntries.filter((e): e is { name: string; value: string; expandable?: boolean } => e !== null);

  const flags: string[] = [];
  if (ae.isMeta) flags.push('meta');
  if (ae.isCompactSummary) flags.push('compact');

  if (entries.length === 0 && flags.length === 0) return null;

  return (
    <details className={styles.metadata}>
      <summary className={styles.metadataSummary}>
        Metadata <span className={styles.metadataCount}>({entries.length + flags.length})</span>
      </summary>
      <div className={styles.metaChips}>
        {entries.map((e) => (
          <MetaChip key={e.name} name={e.name} value={e.value} expandable={e.expandable} />
        ))}
        {flags.map((f) => (
          <span key={f} className={styles.metaFlag}>{f}</span>
        ))}
      </div>
    </details>
  );
}

// ─── Body ─────────────────────────────────────────────────────────────

function TurnPairContent({ pair, turn }: { pair: TurnPairDTO; turn: SessionGraphNode | null }) {
  const ae = pair.assistantEvent;
  return (
    <div className={styles.sections}>
      <Hero turn={turn} agentRole={ae.agentRole} />

      {turn && <StatsGrid turn={turn} />}

      {ae.isApiError && (
        <div className={styles.errorBanner}>
          <div className={styles.errorBannerHead}>
            <AlertTriangle size={14} />
            <span>API error on this turn</span>
          </div>
          {ae.apiErrorStatus && <div className={styles.errorStatus}>{ae.apiErrorStatus}</div>}
        </div>
      )}

      <MetadataBlock ae={ae} turn={turn} />

      {pair.userEvent && (
        <Section title="Input">
          {pair.userEvent.userPrompt ? (
            <ExpandablePre content={pair.userEvent.userPrompt} lang="text" title="User input" />
          ) : (
            <span className={styles.placeholder}>No user input recorded</span>
          )}
        </Section>
      )}

      {ae.thinkingText && (
        <Section title={`Thinking (${ae.thinkingText.length.toLocaleString()} chars)`}>
          <ExpandablePre content={ae.thinkingText} lang="text" title="Thinking" />
        </Section>
      )}

      {ae.thinkingBlocks && ae.thinkingBlocks.length > 0 && (
        <Section title={`Thinking blocks (${ae.thinkingBlocks.length})`}>
          {ae.thinkingBlocks.map((tb, i) => (
            <div key={i} className={styles.thinkingBlock}>
              <ExpandablePre content={tb.text} lang="text" title={`Thinking block #${i + 1}`} />
              {tb.signature && (
                <div className={styles.signatureBox}>
                  <CopyableValue value={tb.signature} maxChars={24} mono label="signature" />
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {ae.toolCallsStructured && ae.toolCallsStructured.length > 0 && (
        <Section title={`Tool calls (${ae.toolCallsStructured.length})`}>
          {ae.toolCallsStructured.map((tc) => (
            <details key={tc.toolUseId} className={styles.toolCall} open={tc.resultIsError === true}>
              <summary className={styles.toolHead}>
                <Badge variant={tc.resultIsError ? 'danger' as any : 'default'}>{tc.toolName}</Badge>
                <div className={styles.toolBadges}>
                  {tc.resultIsError && <span className={`${styles.toolBadge} ${styles.toolBadgeError}`}>error</span>}
                  {typeof tc.resultExitCode === 'number' && (
                    <span
                      className={`${styles.toolBadge} ${tc.resultExitCode !== 0 ? styles.toolBadgeError : ''}`}
                      title="exit code"
                    >exit:{tc.resultExitCode}</span>
                  )}
                  <span className={styles.toolBadge}>
                    <CopyableValue value={tc.toolUseId} maxChars={8} mono label="tool_use_id" />
                  </span>
                </div>
              </summary>
              {tc.inputJson && <SubPre label="input" content={tc.inputJson} title={`${tc.toolName} input`} lang="auto" />}
              {tc.resultStdout && <SubPre label="stdout" content={tc.resultStdout} title={`${tc.toolName} stdout`} lang="text" />}
              {tc.resultStderr && <SubPre label="stderr" content={tc.resultStderr} title={`${tc.toolName} stderr`} lang="text" />}
              {tc.resultContent && <SubPre label="result" content={tc.resultContent} title={`${tc.toolName} result`} lang="auto" />}
            </details>
          ))}
        </Section>
      )}

      {(!ae.toolCallsStructured || ae.toolCallsStructured.length === 0) && ae.toolCalls.length > 0 && (
        <Section title={`Tools (${ae.toolCalls.length})`}>
          {ae.toolCalls.map((tc, i) => (
            <div key={i} className={styles.toolCall}>
              <div className={styles.toolHead}>
                <Badge variant={tc.isError ? 'danger' as any : 'default'}>{tc.tool}</Badge>
                <div className={styles.toolBadges}>
                  {tc.isError && <span className={`${styles.toolBadge} ${styles.toolBadgeError}`}>error</span>}
                  {tc.interrupted && <span className={`${styles.toolBadge} ${styles.toolBadgeWarn}`}>interrupted</span>}
                  {typeof tc.exitCode === 'number' && (
                    <span className={`${styles.toolBadge} ${tc.exitCode !== 0 ? styles.toolBadgeError : ''}`} title="exit code">
                      exit:{tc.exitCode}
                    </span>
                  )}
                  {tc.isImage && (
                    <span className={styles.toolBadge} title="image result">
                      <ImageIcon size={10} /> image
                    </span>
                  )}
                </div>
              </div>
              {tc.inputPreview && <SubPre label="input" content={tc.inputPreview} title={`${tc.tool} input`} lang="auto" />}
              {tc.resultPreview && <SubPre label="result" content={tc.resultPreview} title={`${tc.tool} result`} lang="auto" />}
              {tc.stderr && <SubPre label="stderr" content={tc.stderr} title={`${tc.tool} stderr`} lang="text" />}
            </div>
          ))}
        </Section>
      )}

      <Section title="Output">
        {ae.assistantText ? (
          <ExpandablePre content={ae.assistantText} lang="text" title="Assistant output" />
        ) : (
          <span className={styles.placeholder}>No assistant text</span>
        )}
      </Section>

      {ae.filesChanged && ae.filesChanged.length > 0 && (
        <Section title={`Files changed (${ae.filesChanged.length})`}>
          <div className={styles.filesList}>
            {ae.filesChanged.map((f) => (
              <span key={f} className={styles.fileItem}>
                <CopyableValue value={f} maxChars={60} mono label="file path" />
              </span>
            ))}
          </div>
        </Section>
      )}

      {ae.hooks && ae.hooks.length > 0 && (
        <Section title={`Hooks (${ae.hooks.length})`}>
          <div className={styles.hooksList}>
            {ae.hooks.map((h, i) => (
              <div
                key={i}
                className={`${styles.hookRow} ${h.exitCode && h.exitCode !== 0 ? styles.hookRowErr : ''}`}
                title={h.stderr ?? ''}
              >
                <span className={styles.hookName}>{h.name}</span>
                <span className={styles.hookEvent}>{h.event}</span>
                {typeof h.exitCode === 'number' && <span>exit:{h.exitCode}</span>}
                {typeof h.durationMs === 'number' && <span className={styles.hookDuration}>{h.durationMs}ms</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className={styles.footNote}>
        {pair.assistantEvent.byteSize.toLocaleString()} bytes
        {pair.userEvent ? ` + ${pair.userEvent.byteSize.toLocaleString()} bytes (user)` : ''}
      </div>
    </div>
  );
}

function SubPre({ label, content, title, lang }: { label: string; content: string; title: string; lang: 'auto' | 'text' | 'json' }) {
  return (
    <div>
      <div className={styles.subLabel}>{label}</div>
      <ExpandablePre content={content} lang={lang} title={title} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {children}
    </section>
  );
}
