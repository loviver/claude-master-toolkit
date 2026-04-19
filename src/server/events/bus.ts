import { EventEmitter } from 'events';

export type SessionBusEvent =
  | { type: 'session:created'; sessionId: string; at: number }
  | { type: 'session:updated'; sessionId: string; at: number }
  | { type: 'turn:appended'; sessionId: string; eventId: number; at: number };

class SessionBus extends EventEmitter {
  emitEvent(evt: SessionBusEvent): void {
    this.emit('event', evt);
  }
  subscribe(listener: (evt: SessionBusEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

export const sessionBus = new SessionBus();
sessionBus.setMaxListeners(1000);
