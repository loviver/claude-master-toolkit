import type { ModelKey, Phase } from './types';

/**
 * CSS-variable-backed palette. Values match tokens.css so changes
 * propagate without touching each consumer.
 */

export const MODEL_COLOR: Record<ModelKey, string> = {
  opus:    'var(--model-opus)',
  sonnet:  'var(--model-sonnet)',
  haiku:   'var(--model-haiku)',
  unknown: 'var(--model-unknown)',
};

export const PHASE_COLOR: Record<Phase, string> = {
  exploration:    'var(--phase-exploration)',
  implementation: 'var(--phase-implementation)',
  testing:        'var(--phase-testing)',
  unknown:        'var(--phase-unknown)',
};

export const CHART_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
];

export function modelKeyFromString(model: string): ModelKey {
  if (!model) return 'unknown';
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return 'unknown';
}

export function colorForModel(model: string): string {
  return MODEL_COLOR[modelKeyFromString(model)];
}

export function colorForIndex(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}
