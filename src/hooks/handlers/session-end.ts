import type { HookHandler } from '../runtime/types.js';
import { syncSession } from '../lib/sync.js';
import { purgeSession } from '../lib/state.js';

export const sessionEndHandler: HookHandler = async (e) => {
  if (e.agent === 'claude-code') await syncSession(e.sessionId, 800);
  if (e.reason === 'clear' || e.reason === 'logout') purgeSession(e);
  return { kind: 'noop' };
};
