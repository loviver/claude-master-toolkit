import type { EnrichedTokenEventData } from '../../../shared/types/token-event.js';
import { computeCost } from '../../../shared/pricing.js';

export function computeTotalCost(evts: EnrichedTokenEventData[]): number {
  return evts.reduce((acc, e) => acc + computeCost(e.model, e.usage), 0);
}
