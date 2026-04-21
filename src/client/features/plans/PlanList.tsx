import { useEffect, useState } from 'react';
import type { Plan } from '../../shared/types/plan.js';

export function PlanList() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/plans')
      .then((r) => r.json())
      .then((d) => setPlans(d.plans || []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading plans...</div>;

  return (
    <div style={{ padding: '20px' }}>
      <h2>Workflow Plans</h2>
      {plans.length === 0 ? (
        <p>No plans created yet.</p>
      ) : (
        <ul>
          {plans.map((plan) => (
            <li key={plan.id}>
              <strong>{plan.name}</strong>
              <span style={{ marginLeft: '10px', color: '#666' }}>
                v{plan.version} • {new Date(plan.createdAt).toLocaleString()}
              </span>
              <button
                onClick={() => window.location.href = `/plans/${plan.id}`}
                style={{ marginLeft: '10px' }}
              >
                Execute
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
