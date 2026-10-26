import type { HandlerMap, HookEvent, HookResult } from './types.js';

export const result = {
  noop: (): HookResult => ({ kind: 'noop' }),
  context: (text: string): HookResult => ({ kind: 'context', text }),
  message: (text: string): HookResult => ({ kind: 'message', text }),
  block: (reason: string): HookResult => ({ kind: 'block', reason }),
  ask: (reason: string): HookResult => ({ kind: 'ask', reason }),
};

/** block > ask > (context + message, each concatenated). Noops vanish. */
export function combineResults(results: HookResult[]): HookResult[] {
  const block = results.find((r) => r.kind === 'block');
  if (block) return [block];
  const ask = results.find((r) => r.kind === 'ask');
  if (ask) return [ask];

  const out: HookResult[] = [];
  const contexts = results.flatMap((r) => (r.kind === 'context' ? [r.text] : []));
  const messages = results.flatMap((r) => (r.kind === 'message' ? [r.text] : []));
  if (contexts.length) out.push(result.context(contexts.join('\n\n')));
  if (messages.length) out.push(result.message(messages.join('\n\n')));
  return out;
}

export async function dispatch(event: HookEvent, handlers: HandlerMap): Promise<HookResult[]> {
  const list = handlers[event.event] ?? [];
  const results: HookResult[] = [];
  for (const h of list) {
    try {
      results.push(await h(event));
    } catch {
      // A hook must never break the host agent: failed handler == noop.
    }
  }
  return combineResults(results);
}
