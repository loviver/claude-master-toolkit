import { useEffect } from 'react';

export type StreamHandler = (eventType: string, data: any) => void;

export function useSessionStream(path: string | null, onEvent: StreamHandler): void {
  useEffect(() => {
    if (!path) return;
    const url = `/api${path}`;
    const es = new EventSource(url);

    const types = ['session:created', 'session:updated', 'turn:appended'];
    const handlers = types.map((t) => {
      const h = (ev: MessageEvent) => {
        let data: any = null;
        try { data = JSON.parse(ev.data); } catch { data = ev.data; }
        onEvent(t, data);
      };
      es.addEventListener(t, h as EventListener);
      return [t, h] as const;
    });

    return () => {
      for (const [t, h] of handlers) es.removeEventListener(t, h as EventListener);
      es.close();
    };
  }, [path, onEvent]);
}
