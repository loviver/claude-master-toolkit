import { useState, useEffect } from 'react';
import type { Memory } from '../../lib/types';
import { Modal, Button, Input, FormGroup, Select } from '../../components/ui';

const TYPES = ['bugfix', 'decision', 'architecture', 'discovery', 'pattern', 'config', 'preference'];
const SCOPES = ['project', 'personal'];

type MemoryInput = Partial<Memory> & { title: string; type: string; content: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Memory | null;
  onSubmit: (body: MemoryInput, id?: string) => Promise<void>;
}

export function MemoryDialog({ open, onOpenChange, initial, onSubmit }: Props) {
  const [form, setForm] = useState<MemoryInput>({
    title: '',
    type: 'discovery',
    scope: 'project',
    content: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (initial) {
      setForm({
        title: initial.title,
        type: initial.type,
        scope: initial.scope,
        topicKey: initial.topicKey,
        description: initial.description,
        content: initial.content,
      });
    } else {
      setForm({ title: '', type: 'discovery', scope: 'project', content: '' });
    }
  }, [initial, open]);

  const update = <K extends keyof MemoryInput>(k: K, v: MemoryInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSubmit(form, initial?.id);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? 'Edit Memory' : 'New Memory'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.title || !form.content}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <FormGroup>
        <Input
          label="Title"
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          placeholder="Memory title"
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <Select
            label="Type"
            value={form.type}
            onChange={(e) => update('type', e.target.value)}
            options={TYPES.map((t) => ({ value: t, label: t }))}
          />
          <Select
            label="Scope"
            value={form.scope ?? 'project'}
            onChange={(e) => update('scope', e.target.value)}
            options={SCOPES.map((s) => ({ value: s, label: s }))}
          />
        </div>

        <Input
          label="Topic Key"
          value={form.topicKey ?? ''}
          onChange={(e) => update('topicKey', e.target.value)}
          placeholder="e.g., auth, database"
        />

        <Input
          label="Description"
          value={form.description ?? ''}
          onChange={(e) => update('description', e.target.value)}
          placeholder="Brief description"
        />

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-1)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Content</label>
          <textarea
            value={form.content}
            onChange={(e) => update('content', e.target.value)}
            placeholder="Memory content (markdown)"
            style={{
              width: '100%',
              minHeight: 200,
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              resize: 'vertical',
            }}
          />
        </div>
      </FormGroup>
    </Modal>
  );
}
