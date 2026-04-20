import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';

export function eventToToolCalls(evt: EnrichedTokenEventData, eventId: number) {
  if (!evt.toolCalls?.length) return [];
  return evt.toolCalls.map((tc) => ({
    eventId,
    toolUseId: tc.toolUseId,
    toolName: tc.toolName,
    orderIdx: tc.orderIdx,
    inputJson: tc.inputJson,
    resultIsError: tc.resultIsError ?? undefined,
    resultContent: tc.resultContent,
    resultStderr: tc.resultStderr,
    resultStdout: tc.resultStdout,
    resultExitCode: tc.resultExitCode,
  }));
}
