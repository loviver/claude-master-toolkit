import { useEffect, useState } from 'react';

interface PlanNode {
  id: string;
  type: 'task' | 'agent' | 'decision';
  label: string;
  description?: string;
  config: Record<string, unknown>;
  edges: Array<{ target: string; condition?: string }>;
  retries?: number;
}

interface Plan {
  id: string;
  name: string;
  description?: string;
  definition: { nodes: PlanNode[]; entrypoint: string };
  version: number;
  createdAt: number;
}

interface TimelineEvent {
  nodeId: string;
  at: number;
  status: string;
}

interface Execution {
  id: string;
  planId: string;
  state: 'pending' | 'running' | 'completed' | 'failed';
  currentNodeId?: string;
  timeline: TimelineEvent[];
  error?: string;
}

const NODE_TYPE_COLOR: Record<string, string> = {
  task: '#3b82f6',
  agent: '#8b5cf6',
  decision: '#f59e0b',
};

export function Workflows() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [execution, setExecution] = useState<Execution | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .finally(() => setLoading(false));

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  const handleSelect = (plan: Plan) => {
    setSelected(plan);
    setExecution(null);
    if (pollInterval) clearInterval(pollInterval);
  };

  const handleExecute = async () => {
    if (!selected) return;
    setExecuting(true);
    setExecution(null);

    try {
      const res = await fetch(`/api/plans/${selected.id}/execute`, { method: 'POST' });
      const data = await res.json();
      if (!data.executionId) throw new Error(data.error || 'No executionId');

      const interval = setInterval(async () => {
        const r = await fetch(`/api/plans/${selected.id}/executions/${data.executionId}`);
        const exec: Execution = await r.json();
        setExecution(exec);
        if (exec.state === 'completed' || exec.state === 'failed') {
          clearInterval(interval);
          setExecuting(false);
        }
      }, 800);
      setPollInterval(interval);
    } catch (err) {
      setExecuting(false);
    }
  };

  const statusColor: Record<string, string> = {
    running: '#f59e0b',
    done: '#22c55e',
    failed: '#ef4444',
    pending: '#6b7280',
  };

  return (
    <div style={{ display: 'flex', height: '100%', gap: '0', fontFamily: 'inherit' }}>
      {/* Sidebar: Plan list */}
      <div style={{
        width: '240px', minWidth: '240px', borderRight: '1px solid #27272a',
        padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px',
      }}>
        <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', marginBottom: '8px' }}>
          Plans ({plans.length})
        </div>
        {loading && <div style={{ color: '#71717a', fontSize: '13px' }}>Loading...</div>}
        {!loading && plans.length === 0 && (
          <div style={{ color: '#71717a', fontSize: '13px' }}>
            No plans yet.<br />
            <code style={{ fontSize: '11px' }}>ctk wf create</code>
          </div>
        )}
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => handleSelect(plan)}
            style={{
              background: selected?.id === plan.id ? '#27272a' : 'transparent',
              border: '1px solid',
              borderColor: selected?.id === plan.id ? '#52525b' : 'transparent',
              borderRadius: '6px',
              padding: '8px 10px',
              textAlign: 'left',
              cursor: 'pointer',
              color: '#e4e4e7',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500 }}>{plan.name}</div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>
              v{plan.version} · {plan.definition.nodes.length} nodes
            </div>
          </button>
        ))}
      </div>

      {/* Main: Plan detail + execution */}
      <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ color: '#71717a', marginTop: '40px', textAlign: 'center' }}>
            Select a plan to execute
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
              <button
                onClick={handleExecute}
                disabled={executing}
                style={{
                  marginLeft: 'auto',
                  padding: '8px 16px',
                  background: executing ? '#27272a' : '#6d28d9',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: executing ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                }}
              >
                {executing ? 'Running...' : '▶ Execute'}
              </button>
            </div>

            {/* Node graph (linear list) */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '8px', textTransform: 'uppercase' }}>
                Nodes
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selected.definition.nodes.map((node, idx) => {
                  const nodeState = execution?.timeline
                    .filter((e) => e.nodeId === node.id)
                    .pop();

                  return (
                    <div key={node.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: nodeState
                          ? statusColor[nodeState.status] || '#6b7280'
                          : '#3f3f46',
                        flexShrink: 0,
                      }} />
                      <div style={{
                        flex: 1, padding: '8px 12px',
                        background: '#18181b', borderRadius: '6px',
                        border: '1px solid #27272a',
                      }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{
                            fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                            background: NODE_TYPE_COLOR[node.type] + '22',
                            color: NODE_TYPE_COLOR[node.type],
                            fontWeight: 600,
                          }}>
                            {node.type}
                          </span>
                          <span style={{ fontSize: '13px', color: '#e4e4e7' }}>{node.label}</span>
                          {nodeState && (
                            <span style={{
                              marginLeft: 'auto', fontSize: '11px',
                              color: statusColor[nodeState.status] || '#6b7280',
                            }}>
                              {nodeState.status}
                            </span>
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

            {/* Execution result */}
            {execution && (
              <div style={{ borderTop: '1px solid #27272a', paddingTop: '20px' }}>
                <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '12px', textTransform: 'uppercase' }}>
                  Execution · <span style={{ color: statusColor[execution.state] || '#6b7280' }}>
                    {execution.state}
                  </span>
                </div>

                {execution.error && (
                  <div style={{
                    padding: '10px', background: '#7f1d1d22', border: '1px solid #7f1d1d',
                    borderRadius: '6px', color: '#fca5a5', fontSize: '13px', marginBottom: '12px',
                  }}>
                    {execution.error}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {execution.timeline.map((event, idx) => (
                    <div key={idx} style={{
                      display: 'flex', gap: '12px', fontSize: '12px',
                      color: statusColor[event.status] || '#71717a',
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
    </div>
  );
}
