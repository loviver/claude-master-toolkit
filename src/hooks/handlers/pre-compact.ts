import type { HookHandler } from '../runtime/types.js';

export const preCompactHandler: HookHandler = (e) => ({
  kind: 'message',
  text: `⏳ Compaction (${e.trigger ?? 'unknown'}) imminent. Call mem_session({ action: "summary", content }) NOW (or legacy pandorica_session_summary) to persist this session before the window is compressed.`,
});
