import type { FastifyRequest, FastifyReply } from 'fastify';
import { sessionBus, type SessionBusEvent } from '../events/bus.js';

export function writeSseEvent(reply: FastifyReply, event: string, data: unknown): void {
  reply.raw.write(`event: ${event}\n`);
  reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  if (typeof (reply.raw as any).flush === 'function') (reply.raw as any).flush();
}

export function openSseStream(
  reply: FastifyReply,
  req: FastifyRequest,
  onEvent: (evt: SessionBusEvent) => void,
): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  reply.raw.flushHeaders();
  reply.raw.write(': connected\n\n');

  const unsubscribe = sessionBus.subscribe(onEvent);
  const keepalive = setInterval(() => {
    try { reply.raw.write(': keepalive\n\n'); } catch {}
  }, 15_000);

  const close = () => {
    clearInterval(keepalive);
    unsubscribe();
    try { reply.raw.end(); } catch {}
  };
  req.raw.on('close', close);
  req.raw.on('error', close);
}
