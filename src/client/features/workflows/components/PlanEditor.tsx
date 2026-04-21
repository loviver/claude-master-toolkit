import { useState } from 'react';
import type { Plan, PlanDefinition } from '../../../../shared/types/plan.js';
import { validatePlan } from '../lib/validatePlan.js';

interface Props {
  initial?: Plan;
  onSave: (body: { name: string; description?: string; definition: PlanDefinition }) => Promise<void>;
  onCancel: () => void;
}

export function PlanEditor({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [defText, setDefText] = useState(
    JSON.stringify(
      initial?.definition ?? { entrypoint: 'start', nodes: [{ id: 'start', type: 'task', label: 'Start', config: {}, edges: [] }] },
      null,
      2,
    ),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setErrors([]);
    if (!name.trim()) {
      setErrors(['name required']);
      return;
    }
    let def: PlanDefinition;
    try {
      def = JSON.parse(defText);
    } catch (e) {
      setErrors([`Invalid JSON: ${(e as Error).message}`]);
      return;
    }
    const result = validatePlan(def);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim() || undefined, definition: def });
    } catch (e) {
      setErrors([(e as Error).message]);
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        width: '640px', maxHeight: '85vh', background: '#0a0a0a',
        border: '1px solid #27272a', borderRadius: '8px', padding: '24px',
        display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto',
      }}>
        <h3 style={{ margin: 0, color: '#f4f4f5' }}>
          {initial ? 'Edit Plan' : 'New Plan'}
        </h3>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>Definition (JSON)</span>
          <textarea
            value={defText}
            onChange={(e) => setDefText(e.target.value)}
            rows={16}
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '12px', resize: 'vertical' }}
          />
        </label>

        {errors.length > 0 && (
          <div style={{
            padding: '10px', background: '#7f1d1d22', border: '1px solid #7f1d1d',
            borderRadius: '6px', color: '#fca5a5', fontSize: '12px',
          }}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={saving} style={btnSecondary}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={btnPrimary}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#18181b', border: '1px solid #27272a', borderRadius: '6px',
  padding: '8px 10px', color: '#e4e4e7', fontSize: '13px',
};

const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: '#6d28d9', color: '#fff', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
};

const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'transparent', color: '#e4e4e7',
  border: '1px solid #27272a', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};
