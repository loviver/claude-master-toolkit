import { useEffect, useRef } from 'react';
import { stableQueryKey, backoffDelay } from './stream-helpers';

export type StreamHandler = (eventType: string, data: any) => void;

const STREAM_EVENTS = ['session:created', 'session:updated', 'turn:appended', 'heartbeat'] as const;
const HEARTBEAT_TIMEOUT_MS = 30_000;

export function useSessionStream(path: string | null, onEvent: StreamHandler): void {
  const handlerRef = useRef<StreamHandler>(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!path) return;
    const url = `/api${path}`;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;

    const armHeartbeat = () => {
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      heartbeatTimer = setTimeout(() => {
        if (closed) return;
        if (es) es.close();
        scheduleReconnect();
      }, HEARTBEAT_TIMEOUT_MS);
    };

    const scheduleReconnect = () => {
      if (closed || reconnectTimer) return;
      const delay = backoffDelay(attempts);
      attempts += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (closed) return;
      es = new EventSource(url);

      for (const t of STREAM_EVENTS) {
        es.addEventListener(t, (ev) => {
          armHeartbeat();
          attempts = 0;
          if (t === 'heartbeat') return;
          let data: any = null;
          try { data = JSON.parse((ev as MessageEvent).data); } catch { data = (ev as MessageEvent).data; }
          handlerRef.current(t, data);
        });
      }

      es.onerror = () => {
        if (es) es.close();
        es = null;
        scheduleReconnect();
      };

      armHeartbeat();
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearTimeout(heartbeatTimer);
      if (es) es.close();
    };
  }, [path]);
}

/**
 * Debounced invalidator: collects unique queryKey prefixes over a window and
 * flushes a single batch of invalidateQueries. Prevents render storms when
 * the SSE bus fires rapid `turn:appended` during an active sync.
 */
export function useDebouncedInvalidator(
  invalidate: (key: readonly unknown[]) => void,
  waitMs = 150,
) {
  const pending = useRef<Map<string, readonly unknown[]>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (key: readonly unknown[]) => {
    pending.current.set(stableQueryKey(key), key);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      const keys = Array.from(pending.current.values());
      pending.current.clear();
      timer.current = null;
      for (const k of keys) invalidate(k);
    }, waitMs);
  };
}
