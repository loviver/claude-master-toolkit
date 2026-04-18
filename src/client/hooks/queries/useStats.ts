import { useQuery } from '@tanstack/react-query';
import { fetchApi, toQueryString } from './api';
import type { FilterState } from '../../lib/filters';
import type {
  CurrentStats,
  TimelinePoint,
  ModelStats,
  ToolEfficiency,
  PhaseBreakdown,
  ToolStats,
  EfficiencyScore,
  DashboardBundle,
  ProjectStats,
} from '../../lib/types';

type StatsFilters = Partial<FilterState> & { sessionId?: string };

function qs(f?: StatsFilters): string {
  if (!f) return '';
  return toQueryString({
    sessionId: f.sessionId,
    range: f.dateRange,
    project: f.project,
    model: f.model,
  });
}

export function useCurrentStats(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'current', filters],
    queryFn: () => fetchApi<CurrentStats>(`/stats/current${qs(filters)}`),
  });
}

export function useTimeline(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'timeline', filters],
    queryFn: () => fetchApi<TimelinePoint[]>(`/stats/timeline${qs(filters)}`),
  });
}

export function useModelStats(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'models', filters],
    queryFn: () => fetchApi<ModelStats[]>(`/stats/models${qs(filters)}`),
  });
}

export function useToolEfficiency(filters?: StatsFilters) {
  return useQuery({
    queryKey: ['stats', 'efficiency', filters],
    queryFn: () => fetchApi<ToolEfficiency>(`/stats/efficiency${qs(filters)}`),
  });
}

export function usePhaseBreakdown(filters?: StatsFilters) {
  return useQuery({
    queryKey: ['stats', 'phases', filters],
    queryFn: () => fetchApi<PhaseBreakdown>(`/stats/phases${qs(filters)}`),
  });
}

export function useToolStats(filters?: StatsFilters) {
  return useQuery({
    queryKey: ['stats', 'tools', filters],
    queryFn: () => fetchApi<ToolStats>(`/stats/tools${qs(filters)}`),
  });
}

export function useEfficiencyScore(sessionId?: string) {
  return useQuery({
    queryKey: ['stats', 'score', sessionId],
    queryFn: () => fetchApi<EfficiencyScore>(`/stats/score${sessionId ? `?sessionId=${sessionId}` : ''}`),
    enabled: sessionId !== undefined,
  });
}

export function useDashboard(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'dashboard', filters],
    queryFn: () => fetchApi<DashboardBundle>(`/stats/dashboard${qs(filters)}`),
  });
}

export function useProjects(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'projects', filters],
    queryFn: () => fetchApi<ProjectStats[]>(`/stats/projects${qs(filters)}`),
  });
}

export function useActivity(filters?: Partial<FilterState>) {
  return useQuery({
    queryKey: ['stats', 'activity', filters],
    queryFn: () => fetchApi<Array<{ dow: number; hour: number; turns: number; costUsd: number }>>(`/stats/activity${qs(filters)}`),
  });
}
