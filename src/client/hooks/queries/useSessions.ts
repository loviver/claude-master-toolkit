import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, toQueryString } from './api';
import { useSessionStream, useDebouncedInvalidator } from '../useSessionStream';
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
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSessionGraphLive(id: string | undefined) {
  const query = useSessionGraph(id);
  const queryClient = useQueryClient();
  const invalidate = useMemo(
    () => (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient],
  );
  const debounced = useDebouncedInvalidator(invalidate);
  const onEvent = useCallback((type: string) => {
    if (type !== 'turn:appended' && type !== 'session:updated') return;
    debounced(['sessions', id, 'graph']);
    debounced(['sessions', id]);
  }, [debounced, id]);
  useSessionStream(id ? `/sessions/${id}/stream` : null, onEvent);
  return query;
}

/**
 * Live detail — invalidates session detail, git-stats, and turn content on
 * turn:appended / session:updated for `id`.
 */
export function useSessionDetailLive(id: string | undefined): void {
  const queryClient = useQueryClient();
  const invalidate = useMemo(
    () => (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient],
  );
  const debounced = useDebouncedInvalidator(invalidate);
  const onEvent = useCallback((type: string) => {
    if (type !== 'turn:appended' && type !== 'session:updated') return;
    debounced(['sessions', id]);
    debounced(['sessions', id, 'git-stats']);
  }, [debounced, id]);
  useSessionStream(id ? `/sessions/${id}/stream` : null, onEvent);
}

/**
 * Global live — list + stats + projects. Mount once at Layout level.
 * Debounced to collapse rapid turn:appended bursts (chokidar rapid fires
 * during an active sync) into a single batch of invalidations.
 */
export function useSessionsListLive(): void {
  const queryClient = useQueryClient();
  const invalidate = useMemo(
    () => (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient],
  );
  const debounced = useDebouncedInvalidator(invalidate);
  const onEvent = useCallback(() => {
    debounced(['sessions']);
    debounced(['stats']);
  }, [debounced]);
  useSessionStream('/sessions/stream', onEvent);
}

export function useTurnContent(sessionId: string | undefined, eventId: number | null) {
  return useQuery({
    queryKey: ['sessions', sessionId, 'turns', eventId, 'content'],
    queryFn: () => fetchApi<TurnPairDTO>(`/sessions/${sessionId}/turns/${eventId}/content`),
    enabled: !!sessionId && eventId != null,
    staleTime: 5 * 60_000,
  });
}
