import { useState } from 'react';
import type { Plan } from '../../../shared/types/plan.js';
import {
  usePlans,
  useExecution,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
} from './hooks/useWorkflows.js';
import { PlanEditor } from './components/PlanEditor.js';

const NODE_TYPE_COLOR: Record<string, string> = {
  task: '#3b82f6',
  agent: '#8b5cf6',
  decision: '#f59e0b',
};

const STATUS_COLOR: Record<string, string> = {
  running: '#f59e0b',
  done: '#22c55e',
  failed: '#ef4444',
  pending: '#6b7280',
  completed: '#22c55e',
};

type EditorMode = { kind: 'closed' } | { kind: 'create' } | { kind: 'edit'; plan: Plan };

export function Workflows() {
  const { data: plans = [], isLoading } = usePlans();
  const [selected, setSelected] = useState<Plan | null>(null);
  const [execId, setExecId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [editor, setEditor] = useState<EditorMode>({ kind: 'closed' });

  const createMut = useCreatePlan();
  const updateMut = useUpdatePlan();
  const deleteMut = useDeletePlan();

  const { data: execution } = useExecution(selected?.id ?? '', execId, executing);

  if (execution && (execution.state === 'completed' || execution.state === 'failed') && executing) {
    setExecuting(false);
  }

  const handleExecute = async () => {
    if (!selected) return;
    setExecId(null);
    setExecuting(true);
    try {
      const res = await fetch(`/api/plans/${selected.id}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!data.executionId) throw new Error(data.error || 'No executionId');
      setExecId(data.executionId);
    } catch {
      setExecuting(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Delete plan "${selected.name}"?`)) return;
    await deleteMut.mutateAsync(selected.id);
    setSelected(null);
    setExecId(null);
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: 0, fontFamily: 'inherit' }}>
      {/* Sidebar */}
      <div style={{
        width: '240px', minWidth: '240px', borderRight: '1px solid #27272a',
        padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>
            Plans ({plans.length})
          </div>
          <button
            onClick={() => setEditor({ kind: 'create' })}
            title="New plan"
            style={{
              background: '#6d28d9', color: '#fff', border: 'none', borderRadius: '4px',
              padding: '2px 8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
            }}
          >+ New</button>
        </div>
        {isLoading && <div style={{ color: '#71717a', fontSize: '13px' }}>Loading...</div>}
        {!isLoading && plans.length === 0 && (
          <div style={{ color: '#71717a', fontSize: '13px' }}>No plans yet.</div>
        )}
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => { setSelected(plan); setExecId(null); }}
            style={{
              background: selected?.id === plan.id ? '#27272a' : 'transparent',
              border: '1px solid',
              borderColor: selected?.id === plan.id ? '#52525b' : 'transparent',
              borderRadius: '6px', padding: '8px 10px', textAlign: 'left',
              cursor: 'pointer', color: '#e4e4e7',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500 }}>{plan.name}</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>
              v{plan.version} · {plan.definition.nodes.length} nodes
            </div>
          </button>
        ))}
      </div>

      {/* Main */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ color: '#71717a', marginTop: '40px', textAlign: 'center' }}>
            Select a plan or create one
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', color: '#f4f4f5' }}>{selected.name}</h2>
                {selected.description && (
                  <div style={{ color: '#71717a', fontSize: '13px', marginTop: '2px' }}>{selected.description}</div>
                )}
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setEditor({ kind: 'edit', plan: selected })}
                  style={btnSecondary}
                >Edit</button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMut.isPending}
                  style={{ ...btnSecondary, color: '#fca5a5', borderColor: '#7f1d1d' }}
                >Delete</button>
                <button
                  onClick={handleExecute}
                  disabled={executing}
                  style={{
                    padding: '8px 16px',
                    background: executing ? '#27272a' : '#6d28d9',
                    color: '#fff', border: 'none', borderRadius: '6px',
                    cursor: executing ? 'not-allowed' : 'pointer',
                    fontSize: '13px', fontWeight: 500,
                  }}
                >{executing ? 'Running...' : '▶ Execute'}</button>
              </div>
            </div>

            {/* Node list */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px', textTransform: 'uppercase' }}>
                Nodes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selected.definition.nodes.map((node, idx) => {
                  const nodeEvent = execution?.timeline
                    ?.filter((e: any) => e.nodeId === node.id)
                    .pop();
                  return (
                    <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: nodeEvent ? STATUS_COLOR[nodeEvent.status] || '#6b7280' : '#3f3f46',
                        flexShrink: 0,
                      }} />
                      <div style={{
                        flex: 1, padding: '8px 12px', background: '#18181b',
                        borderRadius: '6px', border: '1px solid #27272a',
                      }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                            background: NODE_TYPE_COLOR[node.type] + '22',
                            color: NODE_TYPE_COLOR[node.type], fontWeight: 600,
                          }}>{node.type}</span>
                          <span style={{ fontSize: '13px', color: '#e4e4e7' }}>{node.label}</span>
                          {nodeEvent && (
                            <span style={{
                              marginLeft: 'auto', fontSize: '11px',
                              color: STATUS_COLOR[nodeEvent.status] || '#6b7280',
                            }}>{nodeEvent.status}</span>
                          )}
                        </div>
                      </div>
                      {idx < selected.definition.nodes.length - 1 && (
                        <div style={{ color: '#52525b', fontSize: '16px' }}>→</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {execution && (
              <div style={{ borderTop: '1px solid #27272a', paddingTop: '20px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '12px', textTransform: 'uppercase' }}>
                  Execution · <span style={{ color: STATUS_COLOR[execution.state] || '#6b7280' }}>{execution.state}</span>
                </div>
                {execution.error && (
                  <div style={{
                    padding: '10px', background: '#7f1d1d22', border: '1px solid #7f1d1d',
                    borderRadius: '6px', color: '#fca5a5', fontSize: '13px', marginBottom: '12px',
                  }}>{execution.error}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {(execution.timeline ?? []).map((event: any, idx: number) => (
                    <div key={idx} style={{
                      display: 'flex', gap: '12px', fontSize: '12px',
                      color: STATUS_COLOR[event.status] || '#71717a',
                    }}>
                      <span style={{ color: '#52525b', minWidth: '70px' }}>
                        {new Date(event.at).toLocaleTimeString()}
                      </span>
                      <code style={{ color: '#a78bfa' }}>{event.nodeId}</code>
                      <span>{event.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {editor.kind !== 'closed' && (
        <PlanEditor
          initial={editor.kind === 'edit' ? editor.plan : undefined}
          onCancel={() => setEditor({ kind: 'closed' })}
          onSave={async (body) => {
            if (editor.kind === 'edit') {
              const updated = await updateMut.mutateAsync({ id: editor.plan.id, ...body });
              setSelected(updated);
            } else {
              const created = await createMut.mutateAsync(body);
              setSelected(created);
            }
            setEditor({ kind: 'closed' });
          }}
        />
      )}
    </div>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 14px', background: 'transparent', color: '#e4e4e7',
  border: '1px solid #27272a', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};
