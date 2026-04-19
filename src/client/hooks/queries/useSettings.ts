import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchApi } from './api';

export type Settings = Record<string, unknown>;

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchApi<Settings>('/settings'),
    staleTime: 60_000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      fetchApi<{ key: string; value: unknown }>(`/settings/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      }),
    onMutate: async ({ key, value }) => {
      await qc.cancelQueries({ queryKey: ['settings'] });
      const prev = qc.getQueryData<Settings>(['settings']);
      qc.setQueryData<Settings>(['settings'], (old) => ({ ...(old ?? {}), [key]: value }));
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['settings'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
