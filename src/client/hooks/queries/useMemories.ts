import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchApi, toQueryString } from './api';
import type { Memory } from '../../lib/types';

interface MemoryFilters {
  type?: string;
  search?: string;
  project?: string;
}

export function useMemories(filters?: MemoryFilters) {
  const qs = toQueryString({
    type: filters?.type,
    search: filters?.search,
    project: filters?.project,
  });
  return useQuery({
    queryKey: ['memories', filters],
    queryFn: () => fetchApi<Memory[]>(`/memories${qs}`),
  });
}

export function useMemory(id: string | undefined) {
  return useQuery({
    queryKey: ['memories', id],
    queryFn: () => fetchApi<Memory>(`/memories/${id}`),
    enabled: !!id,
  });
}

type MemoryInput = {
  title: string;
  type: string;
  scope?: string;
  topicKey?: string;
  description?: string;
  content: string;
  projectPath?: string;
  filePath?: string;
  sessionId?: string;
};

export function useCreateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MemoryInput) =>
      fetchApi<{ id: string; created: boolean }>('/memories', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memories'] }),
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<MemoryInput> & { id: string }) =>
      fetchApi<{ updated: boolean }>(`/memories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['memories'] });
      qc.invalidateQueries({ queryKey: ['memories', vars.id] });
    },
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ deleted: boolean }>(`/memories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memories'] }),
  });
}

export function useSyncMemory() {
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<{ synced: boolean }>(`/memories/${id}/sync`, { method: 'POST' }),
  });
}
