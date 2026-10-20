import { readFileSync } from 'fs';
import { sql, eq } from 'drizzle-orm';
import { getDb } from '../../shared/db/db.js';
import { sessions } from '../../shared/db/schema.js';

export interface StatuslineData {
  todayCost: number;
  sessionCost: number;
  model?: string;
}

/**
 * Pure render of the statusline string. IO-free so it is unit-testable.
 * Shape: `$X today · $Y session[ · model]`.
 */
export function renderStatusline({ todayCost, sessionCost, model }: StatuslineData): string {
  let out = `$${todayCost.toFixed(2)} today · $${sessionCost.toFixed(2)} session`;
  if (model) out += ` · ${model}`;
  return out;
}

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Parse the JSON Claude Code injects on stdin for the statusLine command. */
function readStdinContext(): { sessionId?: string; model?: string } {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf-8');
  } catch {
    return {};
  }
  if (!raw.trim()) return {};
  try {
    const j = JSON.parse(raw) as Record<string, any>;
    const sessionId = j.session_id ?? j.sessionId ?? undefined;
    const model = j.model?.display_name ?? j.model?.id ?? (typeof j.model === 'string' ? j.model : undefined);
    return { sessionId, model };
  } catch {
    return {};
  }
}

/**
 * `ctk statusline` — emits the statusline string reading the shared SQLite DB
 * via better-sqlite3 (the same driver Pandorica uses). No external `sqlite3`
 * CLI dependency. Fails silent (empty line) so the statusline degrades cleanly.
 */
export async function statuslineCommand(): Promise<void> {
  try {
    const { sessionId, model } = readStdinContext();
    const db = getDb();

    const dayStart = startOfTodayMs();
    const todayRow = db
      .select({ total: sql<number>`COALESCE(SUM(${sessions.totalCostUsd}), 0)` })
      .from(sessions)
      .where(sql`${sessions.lastActiveAt} >= ${dayStart}`)
      .get();

    let sessionCost = 0;
    if (sessionId) {
      const sRow = db
        .select({ total: sessions.totalCostUsd })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get();
      sessionCost = sRow?.total ?? 0;
    }

    console.log(renderStatusline({
      todayCost: todayRow?.total ?? 0,
      sessionCost,
      model,
    }));
  } catch {
    // Degrade gracefully: empty statusline on any failure.
    console.log('');
  }
}
