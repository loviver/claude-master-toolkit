import type { HookHandler } from '../runtime/types.js';
import { syncSession } from '../lib/sync.js';
import { countToolCalls } from '../lib/transcript.js';
import { hasNagged, markNagged, stateDir } from '../lib/state.js';
import { join } from 'path';

export const stopHandler: HookHandler = async (e) => {
  // Session sync and the edit/save nag read Claude's transcript/DB format; Codex joins in Phase 7.
  if (e.agent !== 'claude-code') return { kind: 'noop' };
  await syncSession(e.sessionId);

  if (!e.transcriptPath) return { kind: 'noop' };
  const threshold = Number(process.env['CTK_HOOK_SAVE_THRESHOLD'] ?? 3);
  const edits = countToolCalls(e.transcriptPath, ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
  if (edits < threshold || hasNagged(e)) return { kind: 'noop' };

  const saves = countToolCalls(e.transcriptPath, ['mem_save']);
  const records = countToolCalls(e.transcriptPath, ['ctk_record']);
  if (saves > 0 || records > 0) return { kind: 'noop' };

  markNagged(e);
  const nagFile = join(stateDir(e), 'nagged');
  const reason = `${edits} edit(s) this session but 0 mem_save / 0 ctk_record calls (threshold=${threshold}).`;
  const how = [
    '   • mem_save — structured, cost-aware memory (Pandorica v2, FTS5)',
    '   • ctk_record — shared finding pool for sub-agents',
  ].join('\n');

  if (process.env['CTK_HOOK_SAVE_STRICT'] === '1') {
    return {
      kind: 'block',
      reason: `\n✗ Blocked Stop: ${reason}\n   Save context before ending the turn:\n${how}\n   Override once: rm ${nagFile}  (or CTK_HOOK_SAVE_STRICT=0)\n`,
    };
  }
  return {
    kind: 'message',
    text: `\n↪  Session hint: ${reason}\n   If any edit represents a decision, bugfix, discovery, or convention:\n${how}\n   Skip this reminder next time with: touch ${nagFile}\n`,
  };
};
