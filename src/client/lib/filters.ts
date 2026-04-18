/**
 * Global filter state — synced via URL search params for shareable views.
 */

import { useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';

export interface FilterState {
  dateRange: '1d' | '7d' | '30d' | '90d' | 'all';
  project?: string;
  model?: 'opus' | 'sonnet' | 'haiku' | 'all';
}

export const DEFAULT_FILTERS: FilterState = {
  dateRange: '7d',
  project: undefined,
  model: 'all',
};

const DATE_RANGES: FilterState['dateRange'][] = ['1d', '7d', '30d', '90d', 'all'];

export function useFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<FilterState>(() => {
    const dr = params.get('range') as FilterState['dateRange'] | null;
    return {
      dateRange: dr && DATE_RANGES.includes(dr) ? dr : DEFAULT_FILTERS.dateRange,
      project: params.get('project') ?? undefined,
      model: (params.get('model') as FilterState['model']) ?? 'all',
    };
  }, [params]);

  function setFilter<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    const next = new URLSearchParams(params);
    const mapping: Record<string, string> = { dateRange: 'range', project: 'project', model: 'model' };
    const urlKey = mapping[key as string] ?? (key as string);
    if (value == null || value === '' || value === 'all') {
      next.delete(urlKey);
    } else {
      next.set(urlKey, String(value));
    }
    setParams(next, { replace: true });
  }

  function toQueryString(): string {
    const qs = new URLSearchParams();
    if (filters.dateRange && filters.dateRange !== 'all') qs.set('range', filters.dateRange);
    if (filters.project) qs.set('project', filters.project);
    if (filters.model && filters.model !== 'all') qs.set('model', filters.model);
    return qs.toString();
  }

  return { filters, setFilter, toQueryString };
}

export function dateRangeToMs(range: FilterState['dateRange']): number | null {
  switch (range) {
    case '1d':  return 24 * 60 * 60 * 1000;
    case '7d':  return 7 * 24 * 60 * 60 * 1000;
    case '30d': return 30 * 24 * 60 * 60 * 1000;
    case '90d': return 90 * 24 * 60 * 60 * 1000;
    case 'all': return null;
  }
}
