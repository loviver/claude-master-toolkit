const NODE_TYPES = [
  { type: 'task', label: 'Task', color: '#3b82f6' },
  { type: 'agent', label: 'Agent', color: '#8b5cf6' },
  { type: 'decision', label: 'Decision', color: '#f59e0b' },
  { type: 'skill', label: 'Skill', color: '#ec4899' },
  { type: 'bash', label: 'Bash', color: '#10b981' },
  { type: 'read', label: 'Read', color: '#06b6d4' },
  { type: 'edit', label: 'Edit', color: '#eab308' },
  { type: 'subflow', label: 'Subflow', color: '#a855f7' },
  { type: 'parallel', label: 'Parallel', color: '#f97316' },
] as const;

export function NodePalette() {
  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
      {NODE_TYPES.map(({ type, label, color }) => (
        <div
          key={type}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/workflow-node-type', type);
            e.dataTransfer.effectAllowed = 'move';
          }}
          style={{
            padding: '4px 10px',
            borderRadius: '9999px',
            background: color + '22',
            color,
            border: `1px solid ${color}55`,
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'grab',
            userSelect: 'none',
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}
