import type Database from 'better-sqlite3';
import type { BenchVariant } from './types.js';

const METRICS = [
  'input_tokens',
  'output_tokens',
  'cache_read',
  'cache_creation',
  'cost_usd',
  'turn_count',
  'wall_ms',
] as const;

export type MetricKey = (typeof METRICS)[number];

export interface VariantStats {
  variant: BenchVariant;
  n: number;
  metrics: Record<MetricKey, { avg: number; p50: number; p95: number; min: number; max: number }>;
}

export interface CompareResult {
  taskId: string;
  variants: VariantStats[];
  delta: Partial<Record<MetricKey, { absolute: number; relative: number | null }>>; // ctk vs baseline
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function aggregate(values: Record<MetricKey, number[]>): VariantStats['metrics'] {
  const out = {} as VariantStats['metrics'];
  for (const m of METRICS) {
    const vs = [...values[m]].sort((a, b) => a - b);
    const n = vs.length;
    const sum = vs.reduce((acc, v) => acc + v, 0);
    out[m] = {
      avg: n === 0 ? 0 : sum / n,
      p50: percentile(vs, 50),
      p95: percentile(vs, 95),
      min: n === 0 ? 0 : vs[0]!,
      max: n === 0 ? 0 : vs[n - 1]!,
    };
  }
  return out;
}

export function compareTask(db: Database.Database, taskId: string): CompareResult {
  const rows = db
    .prepare(
      `SELECT variant, input_tokens, output_tokens, cache_read, cache_creation,
              cost_usd, turn_count, wall_ms
       FROM bench_runs WHERE task_id = ?`,
    )
    .all(taskId) as Array<
    Record<'variant', BenchVariant> & Record<MetricKey, number>
  >;

  const byVariant = new Map<BenchVariant, Record<MetricKey, number[]>>();
  for (const v of ['ctk', 'baseline'] as BenchVariant[]) {
    byVariant.set(v, {
      input_tokens: [],
      output_tokens: [],
      cache_read: [],
      cache_creation: [],
      cost_usd: [],
      turn_count: [],
      wall_ms: [],
    });
  }

  for (const r of rows) {
    const bucket = byVariant.get(r.variant);
    if (!bucket) continue;
    for (const m of METRICS) bucket[m].push(r[m]);
  }

  const variants: VariantStats[] = ['ctk', 'baseline'].map((v) => {
    const bucket = byVariant.get(v as BenchVariant)!;
    return {
      variant: v as BenchVariant,
      n: bucket.input_tokens.length,
      metrics: aggregate(bucket),
    };
  });

  const ctk = variants.find((v) => v.variant === 'ctk')!;
  const base = variants.find((v) => v.variant === 'baseline')!;
  const delta: CompareResult['delta'] = {};
  for (const m of METRICS) {
    if (ctk.n === 0 || base.n === 0) continue;
    const a = ctk.metrics[m].avg;
    const b = base.metrics[m].avg;
    delta[m] = {
      absolute: a - b,
      relative: b === 0 ? null : (a - b) / b,
    };
  }

  return { taskId, variants, delta };
}
