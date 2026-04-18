import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark, Plus, Search, Edit, Trash2, UploadCloud, Link as LinkIcon } from 'lucide-react';
import {
  useMemories, useCreateMemory, useUpdateMemory, useDeleteMemory, useSyncMemory,
} from '../../hooks/queries/useMemories';
import {
  PageHeader, Card, CardContent, Input, Button, Tag, Select, Stack, EmptyState, Skeleton,
  Icon,
} from '../../components/ui';
import { formatDate, formatRelativeTime, formatProjectName } from '../../lib/format';
import type { Memory } from '../../lib/types';
import { MemoryDialog } from './MemoryDialog';
import styles from './Memories.module.css';

const TYPE_VARIANTS: Record<string, 'blue' | 'red' | 'purple' | 'cyan' | 'green' | 'orange' | 'default'> = {
  bugfix: 'red',
  decision: 'blue',
  architecture: 'purple',
  discovery: 'cyan',
  pattern: 'green',
  config: 'orange',
  preference: 'default',
};

const TYPES = [
  { value: '', label: 'All types' },
  { value: 'bugfix', label: 'bugfix' },
  { value: 'decision', label: 'decision' },
  { value: 'architecture', label: 'architecture' },
  { value: 'discovery', label: 'discovery' },
  { value: 'pattern', label: 'pattern' },
  { value: 'config', label: 'config' },
  { value: 'preference', label: 'preference' },
];

export function Memories() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Memory | null>(null);

  const { data, isLoading } = useMemories({
    search: search || undefined,
    type: type || undefined,
  });

  const createMut = useCreateMemory();
  const updateMut = useUpdateMemory();
  const deleteMut = useDeleteMemory();
  const syncMut = useSyncMemory();
  const navigate = useNavigate();

  const grouped = useMemo(() => {
    const acc: Record<string, Memory[]> = {};
    for (const m of data ?? []) {
      const key = m.projectPath ?? '(no project)';
      if (!acc[key]) acc[key] = [];
      acc[key].push(m);
    }
    return acc;
  }, [data]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (m: Memory) => {
    setEditing(m);
    setDialogOpen(true);
  };

  const handleSubmit = async (body: Partial<Memory> & { title: string; type: string; content: string }, id?: string) => {
    if (id) {
      await updateMut.mutateAsync({ id, ...body });
    } else {
      await createMut.mutateAsync(body);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this memory?')) return;
    await deleteMut.mutateAsync(id);
  };

  const handleSync = async (id: string) => {
    try {
      await syncMut.mutateAsync(id);
      alert('Memory synced to disk');
    } catch (e) {
      alert(`Sync failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        icon={Bookmark}
        title="Memories"
        description="Long-term context stored by the Pandorica protocol"
        actions={
          <Button onClick={openNew}>
            <Icon icon={Plus} size="sm" />
            New memory
          </Button>
        }
      />

      <div className={styles.filters}>
        <div className={styles.searchRow}>
          <Icon icon={Search} size="sm" tone="muted" />
          <Input
            type="text"
            placeholder="Search memories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} options={TYPES} />
      </div>

      {isLoading ? (
        <Skeleton height={400} radius="md" />
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bookmark}
            title={search || type ? 'No memories match your filters' : 'No memories stored yet'}
            description={search || type ? undefined : 'Save long-term context via the Pandorica protocol'}
          />
        </Card>
      ) : (
        <Stack gap={6}>
          {Object.entries(grouped).map(([projectPath, memories]) => (
            <section key={projectPath}>
              <h2 className={styles.groupTitle}>
                {projectPath === '(no project)' ? '(no project)' : formatProjectName(projectPath)}
              </h2>
              <Stack gap={4}>
                {memories.map((m) => (
                  <Card key={m.id}>
                    <CardContent>
                      <div className={styles.cardHead}>
                        <div className={styles.cardHeadLeft}>
                          <h3 className={styles.memTitle}>{m.title}</h3>
                          {m.description && <p className={styles.memDescription}>{m.description}</p>}
                        </div>
                        <div className={styles.actions}>
                          <button className={styles.actionBtn} onClick={() => openEdit(m)} aria-label="Edit">
                            <Icon icon={Edit} size="sm" />
                          </button>
                          {m.filePath && (
                            <button className={styles.actionBtn} onClick={() => handleSync(m.id)} aria-label="Sync to disk">
                              <Icon icon={UploadCloud} size="sm" />
                            </button>
                          )}
                          <button className={styles.actionBtn} onClick={() => handleDelete(m.id)} aria-label="Delete">
                            <Icon icon={Trash2} size="sm" tone="red" />
                          </button>
                        </div>
                      </div>

                      <p className={styles.memContent}>
                        {m.content.slice(0, 200)}
                        {m.content.length > 200 ? '…' : ''}
                      </p>

                      <div className={styles.tags}>
                        <Tag variant={TYPE_VARIANTS[m.type] ?? 'default'}>{m.type}</Tag>
                        {m.scope === 'personal' && <Tag variant="default">personal</Tag>}
                        {m.topicKey && <Tag variant="default">#{m.topicKey}</Tag>}
                      </div>

                      <div className={styles.meta}>
                        <span>Updated {formatRelativeTime(m.updatedAt)}</span>
                        <span>Created {formatDate(m.createdAt)}</span>
                        <span>{m.accessCount} access{m.accessCount === 1 ? '' : 'es'}</span>
                        {m.sessionId && (
                          <button className={styles.sessionLink} onClick={() => navigate(`/sessions/${m.sessionId}`)}>
                            <Icon icon={LinkIcon} size="xs" />
                            From session
                          </button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </Stack>
            </section>
          ))}
        </Stack>
      )}

      <MemoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
