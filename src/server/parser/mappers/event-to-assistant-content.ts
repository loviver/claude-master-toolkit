import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';

export function eventToAssistantContent(evt: EnrichedTokenEventData, eventId: number) {
  if (!evt.content || !evt.contentHash) return null;
  return {
    eventId,
    role: 'assistant' as const,
    content: evt.content,
    contentHash: evt.contentHash,
    byteSize: Buffer.byteLength(evt.content, 'utf-8'),
  };
}
