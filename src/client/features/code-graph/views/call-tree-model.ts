import type { CodeGraphSymbolDTO, CodeGraphUsageDTO } from '../../../lib/types';

export type CallDirection = 'incoming' | 'outgoing';

/** Who calls the symbol (incoming) or whom it calls (outgoing): the next level of the call hierarchy. */
export function callTreeChildren(dto: Pick<CodeGraphSymbolDTO, 'callers' | 'callees'>, direction: CallDirection): CodeGraphUsageDTO[] {
  return direction === 'incoming' ? dto.callers : dto.callees;
}

/** A node already on the path from the root: expanding it again would recurse forever. */
export function isRecursive(path: readonly string[], id: string): boolean {
  return path.includes(id);
}
