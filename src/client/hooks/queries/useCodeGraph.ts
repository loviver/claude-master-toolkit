import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchApi, toQueryString } from './api';
import type {
  CodeGraphDTO,
  CodeGraphLevel,
  CodeGraphProjectDTO,
  CodeGraphRevisionDTO,
  CodeGraphRiskDTO,
} from '../../lib/types';

/** How often a live view checks the index fingerprint (cheap: ~1ms server-side). */
export const LIVE_POLL_MS = 4_000;

export interface CodeGraphParams {
  project: string | undefined;
  level: CodeGraphLevel;
  scope?: string;
  focus?: string;
  depth?: number;
}

export function useCodeGraphProjects() {
  return useQuery({
    queryKey: ['code-graph', 'projects'],
    queryFn: () => fetchApi<CodeGraphProjectDTO[]>('/code-graph/projects'),
  });
}

/** Polls the index revision while `live`; the graph query keys on it to refetch on change. */
export function useCodeGraphRevision(project: string | undefined, live: boolean) {
  return useQuery({
    queryKey: ['code-graph', 'revision', project],
    queryFn: () => fetchApi<CodeGraphRevisionDTO>(`/code-graph/revision${toQueryString({ project })}`),
    enabled: !!project,
    refetchInterval: live ? LIVE_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useCodeGraph(params: CodeGraphParams, revision: string | undefined) {
  const { project, level, scope, focus, depth } = params;
  return useQuery({
    queryKey: ['code-graph', 'graph', project, level, scope, focus, depth, revision],
    queryFn: () => fetchApi<CodeGraphDTO>(`/code-graph${toQueryString({ project, level, scope, focus, depth })}`, { timeoutMs: 60_000 }),
    enabled: !!project && !!revision,
    // Keep showing the previous graph while the next revision loads: the view merges, never blanks.
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export function useCodeGraphRisk(
  project: string | undefined,
  level: CodeGraphLevel,
  revision: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['code-graph', 'risk', project, level, revision],
    queryFn: () => fetchApi<CodeGraphRiskDTO>(`/code-graph/risk${toQueryString({ project, level })}`, { timeoutMs: 30_000 }),
    enabled: enabled && !!project && !!revision,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    retry: false,
  });
}
