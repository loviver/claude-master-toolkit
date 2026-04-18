import { useEffect, useMemo, useState } from 'react';
import { Drawer, Button, Badge, Skeleton, EmptyState, modelKeyBadgeVariant, phaseBadgeVariant } from '../../components/ui';
import { ChevronLeft, ChevronRight, FileQuestion, Maximize2, Minimize2 } from 'lucide-react';
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

const WIDTH_COMPACT = 420;
const WIDTH_WIDE = 640;

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
  const description = turn
    ? `${turn.modelKey} · ${turn.phase} · ${turn.tools.length} tool${turn.tools.length === 1 ? '' : 's'}`
    : '';

  const headerActions = (
    <button
      className={styles.widthToggle}
      onClick={() => setWide((v) => !v)}
      aria-label={wide ? 'Shrink drawer' : 'Expand drawer'}
      title={wide ? 'Shrink (compact)' : 'Expand (wide)'}
    >
      {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );

  return (
    <Drawer
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={title}
      description={description}
      side="right"
      width={wide ? WIDTH_WIDE : WIDTH_COMPACT}
      headerActions={headerActions}
      footer={
        turn && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!prev}
              onClick={() => prev && onSelect(prev.id)}
              title="Previous (←)"
            >
              <ChevronLeft size={14} /> Prev
            </Button>
            <span className={styles.idxLabel}>{idx + 1} / {turns.length}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!next}
              onClick={() => next && onSelect(next.id)}
              title="Next (→)"
            >
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

function TurnPairContent({ pair, turn }: { pair: TurnPairDTO; turn: SessionGraphNode | null }) {
  const ae = pair.assistantEvent;
  return (
    <div className={styles.sections}>
      {ae.isApiError && (
        <div className={styles.errorBanner}>
          <div>⚠ API error on this turn</div>
          {ae.apiErrorStatus && <div className={styles.errorStatus}>{ae.apiErrorStatus}</div>}
        </div>
      )}

      {(ae.slug || ae.requestId || ae.permissionMode) && (
        <div className={styles.idChips}>
          {ae.slug && (
            <span className={styles.idChip} title="slug">🏷 {ae.slug}</span>
          )}
          {ae.permissionMode && (
            <span className={styles.idChip} title="permission mode">🔒 {ae.permissionMode}</span>
          )}
          {ae.requestId && (
            <span
              className={styles.idChip}
              title={`requestId — click to copy\n${ae.requestId}`}
              onClick={() => navigator.clipboard?.writeText(ae.requestId!)}
            >
              🆔 {ae.requestId.slice(0, 14)}…
            </span>
          )}
        </div>
      )}

      {pair.userEvent && (
        <Section title="Input">
          {pair.userEvent.userPrompt ? (
            <pre className={styles.pre}>{pair.userEvent.userPrompt}</pre>
          ) : (
            <span className={styles.placeholder}>No user input recorded</span>
          )}
        </Section>
      )}

      {ae.agentRole && (
        <div className={styles.agentBadge}>
          <Badge variant="outline" title="Sub-agent launched">
            🤖 Agent: {ae.agentRole}
          </Badge>
        </div>
      )}

      {ae.thinkingBlocks && ae.thinkingBlocks.length > 0 && (
        <Section title={`Thinking (${ae.thinkingBlocks.length})`}>
          <details className={styles.thinkingDetails} open>
            <summary>🧠 reasoning blocks (redacted)</summary>
            {ae.thinkingBlocks.map((tb, i) => (
              <div key={i} className={styles.thinkingBlock}>
                <pre className={styles.preSmall}>{tb.text}</pre>
                {tb.signature && (
                  <div className={styles.signatureBox}>
                    <code className={styles.signature}>{tb.signature}</code>
                  </div>
                )}
              </div>
            ))}
          </details>
        </Section>
      )}

      {ae.toolCalls.length > 0 && (
        <Section title={`Tools (${ae.toolCalls.length})`}>
          {ae.toolCalls.map((tc, i) => (
            <div key={i} className={styles.toolCall}>
              <div className={styles.toolHead}>
                <Badge variant={tc.isError ? 'danger' as any : 'default'}>{tc.tool}</Badge>
                <div className={styles.toolBadges}>
                  {tc.isError && <span className={`${styles.toolBadge} ${styles.toolBadgeError}`}>error</span>}
                  {tc.interrupted && <span className={`${styles.toolBadge} ${styles.toolBadgeWarn}`}>interrupted</span>}
                  {typeof tc.exitCode === 'number' && (
                    <span
                      className={`${styles.toolBadge} ${tc.exitCode !== 0 ? styles.toolBadgeError : ''}`}
                      title="exit code"
                    >exit:{tc.exitCode}</span>
                  )}
                  {tc.isImage && <span className={styles.toolBadge} title="image result">🖼 image</span>}
                </div>
              </div>
              {tc.inputPreview && (
                <div>
                  <div className={styles.subLabel}>input</div>
                  <pre className={styles.preSmall}>{tc.inputPreview}</pre>
                </div>
              )}
              {tc.resultPreview && (
                <div>
                  <div className={styles.subLabel}>result</div>
                  <pre className={styles.preSmall}>{tc.resultPreview}</pre>
                </div>
              )}
              {tc.stderr && (
                <div>
                  <div className={styles.subLabel}>stderr</div>
                  <pre className={`${styles.preSmall} ${styles.toolBadgeError}`}>{tc.stderr}</pre>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      <Section title="Output">
        {ae.assistantText ? (
          <pre className={styles.pre}>{ae.assistantText}</pre>
        ) : (
          <span className={styles.placeholder}>No assistant text</span>
        )}
      </Section>

      {ae.filesChanged && ae.filesChanged.length > 0 && (
        <Section title={`Files changed (${ae.filesChanged.length})`}>
          <div className={styles.filesList}>
            {ae.filesChanged.map((f) => (
              <span key={f} className={styles.fileItem}>{f}</span>
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
                {typeof h.durationMs === 'number' && (
                  <span className={styles.hookDuration}>{h.durationMs}ms</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {turn && (
        <div className={styles.turnMeta}>
          <Badge variant={modelKeyBadgeVariant(turn.modelKey)}>{turn.modelKey}</Badge>
          <Badge variant={phaseBadgeVariant(turn.phase)}>{turn.phase}</Badge>
          {turn.stopReason && <Badge variant="info">stop: {turn.stopReason}</Badge>}
          <span className={styles.metaSep} />
          <span className={styles.metaItem} title={`Input tokens: ${turn.inputTokens.toLocaleString()}`}>
            ↓ {turn.inputTokens.toLocaleString()}
          </span>
          <span className={styles.metaItem} title={`Output tokens: ${turn.outputTokens.toLocaleString()}`}>
            ↑ {turn.outputTokens.toLocaleString()}
          </span>
          <span className={styles.metaItem} title={`Cache: ${turn.cacheHitPct}%`}>
            ◈ {turn.cacheHitPct}%
          </span>
          {turn.costUsd > 0 && (
            <span className={styles.metaItem} title="Cost (USD)">
              ${turn.costUsd.toFixed(4)}
            </span>
          )}
        </div>
      )}

      <div className={styles.footNote}>
        {pair.assistantEvent.byteSize.toLocaleString()} bytes
        {pair.userEvent ? ` + ${pair.userEvent.byteSize.toLocaleString()} bytes (user)` : ''}
      </div>
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
