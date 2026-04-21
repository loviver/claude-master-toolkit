import { useEffect, useState } from 'react';
import type { Plan, PlanExecutionState } from '../../shared/types/plan.js';

export function PlanExecutor({ planId }: { planId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [execution, setExecution] = useState<PlanExecutionState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/plans/${planId}`)
      .then((r) => r.json())
      .then((d) => setPlan(d))
      .finally(() => setLoading(false));
  }, [planId]);

  const handleExecute = async () => {
    const res = await fetch(`/api/plans/${planId}/execute`, {
      method: 'POST',
    });
    const data = await res.json();
    if (data.executionId) {
      pollExecution(data.executionId);
    }
  };

  const pollExecution = (execId: string) => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/plans/${planId}/executions/${execId}`);
      const exec = await res.json();
      setExecution(exec);

      if (exec.state === 'completed' || exec.state === 'failed') {
        clearInterval(interval);
      }
    }, 1000);
  };

  if (loading) return <div>Loading plan...</div>;
  if (!plan) return <div>Plan not found</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>{plan.name}</h2>
      <p>{plan.description}</p>

      <button onClick={handleExecute} disabled={execution?.state === 'running'}>
        {execution?.state === 'running' ? 'Executing...' : 'Execute Plan'}
      </button>

      {execution && (
        <div style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
          <h3>Execution: {execution.id}</h3>
          <p>State: <strong>{execution.state}</strong></p>
          <p>Current Node: {execution.currentNodeId || 'N/A'}</p>

          <h4>Timeline</h4>
          <ul style={{ maxHeight: '300px', overflow: 'auto' }}>
            {execution.timeline.map((event, idx) => (
              <li key={idx}>
                <code>{event.nodeId}</code> {event.status} @ {new Date(event.at).toLocaleTimeString()}
              </li>
            ))}
          </ul>

          {execution.error && (
            <div style={{ color: 'red', marginTop: '10px' }}>
              <strong>Error:</strong> {execution.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
