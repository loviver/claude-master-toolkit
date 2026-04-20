import { sessionBus } from '../../events/bus.js';

export function emitSessionEvent(priorSession: { id: string } | undefined, sessionId: string): void {
  sessionBus.emitEvent({
    type: priorSession ? 'session:updated' : 'session:created',
    sessionId,
    at: Date.now(),
  });
}
