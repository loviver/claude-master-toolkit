import { useState, useCallback, useRef } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { Plan } from '../../../shared/types/plan.js';
import type { WfNodeData } from './nodes/WorkflowNodes.js';
import {
  usePlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
} from './hooks/useWorkflows.js';
import { WorkflowCanvas } from './components/WorkflowCanvas.js';
import { NodePalette } from './components/NodePalette.js';
import { NodeInspector } from './components/NodeInspector.js';
import { planToFlow } from './lib/planToFlow.js';
import { flowToPlan } from './lib/planToFlow.js';
import { validatePlan } from './lib/validatePlan.js';

const EMPTY_NODES: Node<WfNodeData>[] = [];
const EMPTY_EDGES: Edge[] = [];

function NewPlanModal({
  onCancel,
  onSubmit,
  saving,
}: {
  onCancel: () => void;
  onSubmit: (name: string, description: string) => void;
  saving: boolean;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        width: '420px', background: '#0a0a0a', border: '1px solid #27272a',
        borderRadius: '8px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '14px',
      }}>
        <h3 style={{ margin: 0, color: '#f4f4f5', fontSize: '16px' }}>New Plan</h3>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onSubmit(name.trim(), description.trim()); }}
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
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={saving} style={btnSecondary}>Cancel</button>
          <button
            onClick={() => { if (name.trim()) onSubmit(name.trim(), description.trim()); }}
            disabled={saving || !name.trim()}
            style={btnPrimary}
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Workflows() {
  const { data: plans = [], isLoading } = usePlans();
  const createMut = useCreatePlan();
  const updateMut = useUpdatePlan();
  const deleteMut = useDeletePlan();

  const [selected, setSelected] = useState<Plan | null>(null);
  const [rfNodes, setRfNodes] = useState<Node<WfNodeData>[]>(EMPTY_NODES);
  const [rfEdges, setRfEdges] = useState<Edge[]>(EMPTY_EDGES);
  const [entrypoint, setEntrypoint] = useState('');
  const [selectedNode, setSelectedNode] = useState<Node<WfNodeData> | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const importRef = useRef<HTMLInputElement>(null);

  const selectPlan = useCallback((plan: Plan) => {
    const { nodes, edges } = planToFlow(plan.definition);
    setSelected(plan);
    setRfNodes(nodes);
    setRfEdges(edges);
    setEntrypoint(plan.definition.entrypoint);
    setSelectedNode(null);
    setDirty(false);
    setSaveError([]);
  }, []);

  const handleCanvasChange = useCallback((nodes: Node<WfNodeData>[], edges: Edge[]) => {
    setRfNodes(nodes);
    setRfEdges(edges);
    setDirty(true);
  }, []);

  const handleNodeSelect = useCallback((node: Node<WfNodeData> | null) => {
    setSelectedNode(node);
  }, []);

  const handleNodeUpdate = useCallback((nodeId: string, data: Partial<WfNodeData>) => {
    setRfNodes((ns) => ns.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
    setDirty(true);
    // Keep selectedNode in sync
    setSelectedNode((prev) => prev?.id === nodeId ? { ...prev, data: { ...prev.data, ...data } } : prev);
  }, []);

  const handleSave = async () => {
    if (!selected) return;
    const def = flowToPlan(rfNodes, rfEdges, entrypoint);
    const result = validatePlan(def);
    if (!result.ok) { setSaveError(result.errors); return; }
    await updateMut.mutateAsync({ id: selected.id, definition: def });
    setDirty(false);
    setSaveError([]);
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm(`Delete plan "${selected.name}"?`)) return;
    await deleteMut.mutateAsync(selected.id);
    setSelected(null);
    setRfNodes(EMPTY_NODES);
    setRfEdges(EMPTY_EDGES);
    setEntrypoint('');
    setSelectedNode(null);
    setDirty(false);
  };

  const handleCreateSubmit = async (name: string, description: string) => {
    const starterId = crypto.randomUUID();
    const starterNode: Node<WfNodeData> = {
      id: starterId,
      type: 'task',
      position: { x: 100, y: 100 },
      data: { label: 'Start', isEntrypoint: true },
    };
    const newDef = {
      nodes: [{
        id: starterId, type: 'task' as const, label: 'Start',
        config: {}, edges: [],
      }],
      entrypoint: starterId,
    };
    const created = await createMut.mutateAsync({
      name,
      description: description || undefined,
      definition: newDef,
    });
    setCreating(false);
    setSelected(created);
    setRfNodes([starterNode]);
    setRfEdges([]);
    setEntrypoint(starterId);
    setSelectedNode(null);
    setDirty(false);
    setSaveError([]);
  };

  // Export
  const handleExport = () => {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected.definition, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.name.replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const def = JSON.parse(evt.target?.result as string);
        const { nodes, edges } = planToFlow(def);
        setRfNodes(nodes);
        setRfEdges(edges);
        setEntrypoint(def.entrypoint ?? '');
        setDirty(true);
      } catch {
        setSaveError(['Invalid JSON file']);
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = '';
  };

  const canvasKey = selected?.id ?? '__empty__';

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: 'inherit', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: '240px', minWidth: '240px', borderRight: '1px solid #27272a',
        padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase' }}>
            Plans ({plans.length})
          </div>
          <button
            onClick={() => setCreating(true)}
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
            onClick={() => selectPlan(plan)}
            style={{
              background: selected?.id === plan.id ? '#27272a' : 'transparent',
              border: '1px solid',
              borderColor: selected?.id === plan.id ? '#52525b' : 'transparent',
              borderRadius: '6px', padding: '8px 10px', textAlign: 'left',
              cursor: 'pointer', color: '#e4e4e7',
            }}
          >
            <div style={{ fontSize: '13px', fontWeight: 500 }}>
              {plan.name}
              {selected?.id === plan.id && dirty && (
                <span style={{ color: '#f59e0b', marginLeft: '6px', fontSize: '10px' }}>●</span>
              )}
            </div>
            <div style={{ fontSize: '11px', color: '#71717a' }}>
              v{plan.version} · {plan.definition.nodes.length} nodes
            </div>
          </button>
        ))}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected && !creating ? (
          <div style={{ color: '#71717a', marginTop: '40px', textAlign: 'center', flex: 1 }}>
            Select a plan or create one
          </div>
        ) : selected ? (
          <>
            {/* Toolbar */}
            <div style={{
              background: '#18181b', borderBottom: '1px solid #27272a',
              padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
            }}>
              <NodePalette />
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                {saveError.length > 0 && (
                  <span style={{ fontSize: '12px', color: '#fca5a5', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {saveError[0]}
                  </span>
                )}
                <button onClick={handleExport} style={btnSecondary} title="Export JSON">
                  ↓ Export
                </button>
                <button onClick={() => importRef.current?.click()} style={btnSecondary} title="Import JSON">
                  ↑ Import
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={handleImportFile}
                />
                <button
                  onClick={handleSave}
                  disabled={!dirty || updateMut.isPending}
                  style={{
                    ...btnPrimary,
                    opacity: !dirty || updateMut.isPending ? 0.5 : 1,
                    cursor: !dirty || updateMut.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  {updateMut.isPending ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleteMut.isPending}
                  style={{ ...btnSecondary, color: '#fca5a5', borderColor: '#7f1d1d' }}
                >Delete</button>
              </div>
            </div>

            {/* Canvas + Inspector */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <WorkflowCanvas
                  key={canvasKey}
                  initialNodes={rfNodes}
                  initialEdges={rfEdges}
                  entrypoint={entrypoint}
                  onChange={handleCanvasChange}
                  onNodeSelect={handleNodeSelect}
                />
              </div>
              <NodeInspector node={selectedNode} onUpdate={handleNodeUpdate} />
            </div>
          </>
        ) : null}
      </div>

      {creating && (
        <NewPlanModal
          onCancel={() => setCreating(false)}
          onSubmit={handleCreateSubmit}
          saving={createMut.isPending}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: '#18181b', border: '1px solid #27272a', borderRadius: '6px',
  padding: '8px 10px', color: '#e4e4e7', fontSize: '13px',
};

const btnPrimary: React.CSSProperties = {
  padding: '6px 14px', background: '#6d28d9', color: '#fff', border: 'none',
  borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
};

const btnSecondary: React.CSSProperties = {
  padding: '6px 12px', background: 'transparent', color: '#e4e4e7',
  border: '1px solid #27272a', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
};
