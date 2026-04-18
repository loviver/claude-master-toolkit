import { readFile } from 'fs/promises';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import type {
  SessionEvent,
  TokenUsage,
  SemanticPhase,
  EnrichedTokenEventData,
  HookAttachment,
  FileHistorySnapshot,
} from './types.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * Encode a CWD path to Claude's project directory format.
 * /home/user/code → -home-user-code
 */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * Find all project directories under ~/.claude/projects/
 */
export function listProjectDirs(): string[] {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return [];
  return readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(CLAUDE_PROJECTS_DIR, d.name));
}

/**
 * Find all .jsonl session files in a project directory, sorted newest first.
 */
export function listSessionFiles(projectDir: string): string[] {
  if (!existsSync(projectDir)) return [];
  return readdirSync(projectDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(projectDir, f))
    .sort((a, b) => {
      const sa = statSync(a).mtimeMs;
      const sb = statSync(b).mtimeMs;
      return sb - sa;
    });
}

/**
 * Get the latest session file for the current project (or a given CWD).
 */
export function getLatestSessionFile(cwd?: string): string | null {
  const projectCwd = cwd ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd();
  const encoded = encodeCwd(projectCwd);
  const projectDir = join(CLAUDE_PROJECTS_DIR, encoded);
  const files = listSessionFiles(projectDir);
  return files[0] ?? null;
}

/**
 * Parse a JSONL file into SessionEvent array.
 * Resilient: skips malformed lines.
 */
export async function parseJsonlFile(filePath: string): Promise<SessionEvent[]> {
  const content = await readFile(filePath, 'utf-8');
  const events: SessionEvent[] = [];

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      // Skip malformed lines
    }
  }

  return events;
}

/**
 * Extract token usage events from parsed session events.
 * Returns one entry per assistant turn that has usage data.
 */
export function extractTokenEvents(events: SessionEvent[]): Array<{
  timestamp: string;
  model: string;
  usage: TokenUsage;
}> {
  return events
    .filter(
      (e): e is SessionEvent & { message: NonNullable<SessionEvent['message']> } =>
        e.type === 'assistant' && !!e.message?.usage,
    )
    .map((e) => ({
      timestamp: e.timestamp,
      model: e.message.model ?? 'unknown',
      usage: {
        inputTokens: e.message.usage!.input_tokens ?? 0,
        outputTokens: e.message.usage!.output_tokens ?? 0,
        cacheReadTokens: e.message.usage!.cache_read_input_tokens ?? 0,
        cacheCreationTokens: e.message.usage!.cache_creation_input_tokens ?? 0,
      },
    }));
}

/**
 * Extract tool names from assistant message content blocks.
 * Returns deduplicated array preserving first-occurrence order.
 */
export function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_use' &&
      typeof (block as Record<string, unknown>).name === 'string'
    ) {
      const name = (block as Record<string, unknown>).name as string;
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
  }
  return result;
}

const EXPLORATION_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Agent', 'Explore', 'WebSearch', 'WebFetch']);
const IMPLEMENTATION_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const TEST_PATTERNS = [/\bvitest\b/, /\bjest\b/, /\bpytest\b/, /\btest\b/, /\bspec\b/];

/**
 * Extract bash commands from content blocks for phase inference.
 */
function extractBashCommands(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const cmds: string[] = [];
  for (const block of content) {
    if (
      typeof block === 'object' &&
      block !== null &&
      (block as Record<string, unknown>).type === 'tool_use' &&
      (block as Record<string, unknown>).name === 'Bash'
    ) {
      const input = (block as Record<string, unknown>).input as Record<string, unknown> | undefined;
      if (input && typeof input.command === 'string') {
        cmds.push(input.command);
      }
    }
  }
  return cmds;
}

/**
 * Infer the semantic phase of a turn based on tools used and bash commands.
 */
export function inferSemanticPhase(tools: string[], bashCommands: string[] = []): SemanticPhase {
  if (tools.length === 0) return 'unknown';

  // Check testing first (Bash with test commands)
  if (tools.includes('Bash') && bashCommands.some((cmd) => TEST_PATTERNS.some((p) => p.test(cmd)))) {
    return 'testing';
  }

  // If any write tool present → implementation
  if (tools.some((t) => IMPLEMENTATION_TOOLS.has(t))) return 'implementation';

  // Bash without test patterns → implementation
  if (tools.includes('Bash')) return 'implementation';

  // All remaining tools are exploration-type
  if (tools.every((t) => EXPLORATION_TOOLS.has(t))) return 'exploration';

  return 'unknown';
}

/**
 * Does the content array contain a thinking block?
 */
function contentHasThinking(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      typeof b === 'object' &&
      b !== null &&
      (b as Record<string, unknown>).type === 'thinking',
  );
}

/**
 * Extract enriched token events with tool usage, phase, content, and metadata.
 */
export function extractEnrichedTokenEvents(events: SessionEvent[]): EnrichedTokenEventData[] {
  // Pre-compute a running permission mode, toggled by 'permission-mode' events.
  // Those events have no timestamp, so we fold by position and snapshot the mode
  // active when each assistant event appears.
  const modeByIdx: string[] = new Array(events.length);
  let currentMode = 'default';
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type === 'permission-mode' && typeof ev.permissionMode === 'string') {
      currentMode = ev.permissionMode;
    }
    modeByIdx[i] = currentMode;
  }

  const result: EnrichedTokenEventData[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'assistant' || !e.message?.usage) continue;

    const content = e.message.content;
    const toolsUsed = extractToolNames(content);
    const bashCommands = extractBashCommands(content);
    const contentStr = JSON.stringify(content);
    const contentHash = createHash('sha256').update(contentStr).digest('hex');
    const usage = e.message.usage;

    result.push({
      uuid: e.uuid,
      timestamp: e.timestamp,
      model: e.message.model ?? 'unknown',
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      },
      toolsUsed,
      stopReason: e.message.stop_reason ?? 'unknown',
      isSidechain: e.isSidechain ?? false,
      parentUuid: e.parentUuid,
      semanticPhase: inferSemanticPhase(toolsUsed, bashCommands),
      content: contentStr,
      contentHash,
      messageId: e.message.id,
      requestId: e.requestId,
      slug: e.slug,
      apiErrorStatus: e.apiErrorStatus,
      isApiError: !!e.isApiErrorMessage,
      serviceTier: usage.service_tier,
      speed: usage.speed,
      cache1h: usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      cache5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      webSearchCount: usage.server_tool_use?.web_search_requests ?? 0,
      webFetchCount: usage.server_tool_use?.web_fetch_requests ?? 0,
      iterationsCount: Array.isArray(usage.iterations) ? usage.iterations.length : 0,
      hasThinking: contentHasThinking(content),
      permissionMode: modeByIdx[i],
    });
  }
  return result;
}

/**
 * Map `system.turn_duration` events to their owning assistant turn's uuid
 * (the system event's parentUuid).
 */
export function extractTurnDurations(events: SessionEvent[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'system' && e.subtype === 'turn_duration' && e.parentUuid && typeof e.durationMs === 'number') {
      out.set(e.parentUuid, e.durationMs);
    }
  }
  return out;
}

/**
 * Extract hook-related attachment events.
 */
export function extractHookAttachments(events: SessionEvent[]): HookAttachment[] {
  const out: HookAttachment[] = [];
  for (const e of events) {
    if (e.type !== 'attachment' || !e.attachment) continue;
    const a = e.attachment;
    if (!a.hookName || !a.hookEvent) continue;
    out.push({
      parentUuid: e.parentUuid,
      uuid: e.uuid,
      hookName: a.hookName,
      hookEvent: a.hookEvent,
      exitCode: a.exitCode,
      durationMs: a.durationMs,
      stdout: a.stdout,
      stderr: a.stderr,
      command: a.command,
      timestamp: e.timestamp,
    });
  }
  return out;
}

/**
 * Extract file-history-snapshot events. `messageId` matches the assistant turn's uuid.
 */
export function extractFileHistorySnapshots(events: SessionEvent[]): FileHistorySnapshot[] {
  const out: FileHistorySnapshot[] = [];
  for (const e of events) {
    if (e.type !== 'file-history-snapshot') continue;
    const mid = e.messageId ?? e.snapshot?.messageId;
    if (!mid) continue;
    const tfb = e.snapshot?.trackedFileBackups ?? {};
    const files = Object.keys(tfb);
    if (files.length === 0) continue;
    out.push({
      messageId: mid,
      isSnapshotUpdate: !!e.isSnapshotUpdate,
      files,
      timestamp: e.snapshot?.timestamp,
    });
  }
  return out;
}

/**
 * Get cumulative token usage from a session file.
 */
export async function getSessionTokens(filePath: string): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);

  return tokenEvents.reduce<TokenUsage>(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.usage.inputTokens,
      outputTokens: acc.outputTokens + e.usage.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + e.usage.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.usage.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
}

/**
 * Get latest turn's token usage (current context window).
 */
export async function getLatestTurnUsage(filePath: string): Promise<TokenUsage> {
  const events = await parseJsonlFile(filePath);
  const tokenEvents = extractTokenEvents(events);
  const last = tokenEvents.at(-1);

  if (!last) {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  }

  return last.usage;
}

/**
 * Extract session metadata from events.
 */
export function extractSessionMeta(events: SessionEvent[]): {
  sessionId: string;
  startedAt: string;
  lastActiveAt: string;
  cwd: string;
  gitBranch?: string;
  version?: string;
  primaryModel: string;
  turnCount: number;
} {
  const first = events[0];

  // Find most-used model
  const modelCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'assistant' && e.message?.model) {
      const m = e.message.model;
      modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
    }
  }
  const primaryModel = [...modelCounts.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const turnCount = events.filter((e) => e.type === 'assistant').length;

  // Compute min/max timestamps across all events — JSONL lines are not
  // guaranteed to be in chronological order (resumed sessions, out-of-order
  // appends). Using events[0]/events.at(-1) would mis-report duration.
  let minTs: string | undefined;
  let maxTs: string | undefined;
  for (const e of events) {
    if (!e.timestamp) continue;
    if (minTs === undefined || e.timestamp < minTs) minTs = e.timestamp;
    if (maxTs === undefined || e.timestamp > maxTs) maxTs = e.timestamp;
  }
  const fallback = new Date().toISOString();

  return {
    sessionId: first?.sessionId ?? basename(first?.uuid ?? 'unknown'),
    startedAt: minTs ?? fallback,
    lastActiveAt: maxTs ?? minTs ?? fallback,
    cwd: first?.cwd ?? '',
    gitBranch: first?.gitBranch,
    version: first?.version,
    primaryModel,
    turnCount,
  };
}
