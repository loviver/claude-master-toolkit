import { useQuery } from '@tanstack/react-query';
import { fetchApi, toQueryString } from './api';
import type { FilterState } from '../../lib/filters';
import type {
  SessionSummary, SessionDetail, GitStats, SessionGraph, TurnContentDTO, TurnPairDTO,
} from '../../lib/types';

export function useSessions(filters?: Partial<FilterState> & { q?: string; limit?: number; offset?: number }) {
  const qs = toQueryString({
    range: filters?.dateRange,
    project: filters?.project,
    model: filters?.model,
    q: filters?.q,
    limit: filters?.limit,
    offset: filters?.offset,
  });
  return useQuery({
    queryKey: ['sessions', filters],
    queryFn: () => fetchApi<SessionSummary[]>(`/sessions${qs}`),
  });
}

export function useSessionDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['sessions', id],
    queryFn: () => fetchApi<SessionDetail>(`/sessions/${id}`),
    enabled: !!id,
  });
}

export function useSessionGitStats(id: string | undefined) {
  return useQuery({
    queryKey: ['sessions', id, 'git-stats'],
    queryFn: () => fetchApi<GitStats>(`/sessions/${id}/git-stats`),
    enabled: !!id,
  });
}

export function useSessionGraph(id: string | undefined) {
  return useQuery({
    queryKey: ['sessions', id, 'graph'],
    queryFn: () => fetchApi<SessionGraph>(`/sessions/${id}/graph`),
    enabled: !!id,
  });
}

export function useTurnContent(sessionId: string | undefined, eventId: number | null) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'turns', eventId, 'content'],
    queryFn: () => fetchApi<TurnPairDTO>(`/sessions/${sessionId}/turns/${eventId}/content`),
    enabled: !!sessionId && eventId != null,
    staleTime: 5 * 60_000,
  });
}
