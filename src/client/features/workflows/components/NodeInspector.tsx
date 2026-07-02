import type { Node } from '@xyflow/react';
import type { WfNodeData } from '../nodes/WorkflowNodes.js';

const NODE_TYPE_COLOR: Record<string, string> = {
  task: '#3b82f6',
  agent: '#8b5cf6',
  decision: '#f59e0b',
  skill: '#ec4899',
  bash: '#10b981',
  read: '#06b6d4',
  edit: '#eab308',
  subflow: '#a855f7',
  parallel: '#f97316',
};

const KNOWN_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'WebFetch', 'WebSearch',
  'Agent', 'Skill', 'NotebookEdit', 'TaskCreate',
];

interface NodeInspectorProps {
  node: Node<WfNodeData> | null;
  onUpdate: (nodeId: string, data: Partial<WfNodeData>) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#71717a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '4px',
  display: 'block',
};

const inputStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: '6px',
  padding: '7px 10px',
  color: '#e4e4e7',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  marginBottom: '14px',
};

export function NodeInspector({ node, onUpdate }: NodeInspectorProps) {
  const containerStyle: React.CSSProperties = {
    width: '260px',
    minWidth: '260px',
    background: '#0a0a0a',
    borderLeft: '1px solid #27272a',
    padding: '16px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
  };

  if (!node) {
    return (
      <div style={containerStyle}>
        <div style={{ color: '#52525b', fontSize: '13px', marginTop: '20px', textAlign: 'center' }}>
          Select a node to inspect
        </div>
      </div>
    );
  }

  const config = (node.data.config ?? {}) as Record<string, unknown>;
  const nodeType = node.type ?? 'task';
  const typeColor = NODE_TYPE_COLOR[nodeType] ?? '#71717a';

  const updateConfig = (key: string, value: unknown) => {
    onUpdate(node.id, { config: { ...config, [key]: value } });
  };

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', marginBottom: '8px' }}>
          Node Inspector
        </div>
        <span style={{
          padding: '2px 8px',
          borderRadius: '9999px',
          background: typeColor + '22',
          color: typeColor,
          border: `1px solid ${typeColor}55`,
          fontSize: '11px',
          fontWeight: 600,
        }}>
          {nodeType}
        </span>
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>Label</label>
        <input
          style={inputStyle}
          value={node.data.label}
          onChange={(e) => onUpdate(node.id, { label: e.target.value })}
        />
      </div>

      <div style={sectionStyle}>
        <label style={labelStyle}>Description</label>
        <textarea
          style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }}
          value={node.data.description ?? ''}
          onChange={(e) => onUpdate(node.id, { description: e.target.value })}
        />
      </div>

      <div style={{ borderTop: '1px solid #27272a', paddingTop: '14px', marginTop: '4px' }}>
        <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', marginBottom: '12px' }}>
          Config
        </div>

        {nodeType === 'task' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Command</label>
              <input
                style={inputStyle}
                value={(config.command as string) ?? ''}
                onChange={(e) => updateConfig('command', e.target.value)}
                placeholder="shell command"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Script</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px', fontFamily: 'monospace', fontSize: '12px' }}
                value={(config.script as string) ?? ''}
                onChange={(e) => updateConfig('script', e.target.value)}
                placeholder="script content"
              />
            </div>
          </>
        )}

        {nodeType === 'agent' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Subagent Type</label>
              <input
                style={inputStyle}
                value={(config.subagent_type as string) ?? (config.agentRole as string) ?? ''}
                onChange={(e) => updateConfig('subagent_type', e.target.value)}
                placeholder="Explore, general-purpose, etc."
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Prompt</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
                value={(config.prompt as string) ?? (config.agentPrompt as string) ?? ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder="agent prompt"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Model</label>
              <select
                style={inputStyle}
                value={(config.model as string) ?? 'inherit'}
                onChange={(e) => updateConfig('model', e.target.value)}
              >
                <option value="inherit">inherit</option>
                <option value="opus">opus</option>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
              </select>
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Tool Whitelist</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {KNOWN_TOOLS.map((tool) => {
                  const list = (config.toolWhitelist as string[]) ?? [];
                  const active = list.includes(tool);
                  return (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => {
                        const next = active ? list.filter((t) => t !== tool) : [...list, tool];
                        updateConfig('toolWhitelist', next);
                      }}
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '11px',
                        cursor: 'pointer',
                        background: active ? '#8b5cf622' : 'transparent',
                        color: active ? '#a78bfa' : '#71717a',
                        border: `1px solid ${active ? '#8b5cf655' : '#27272a'}`,
                      }}
                    >
                      {tool}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={sectionStyle}>
              <label style={{ ...labelStyle, display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.run_in_background)}
                  onChange={(e) => updateConfig('run_in_background', e.target.checked)}
                />
                Run in background
              </label>
            </div>
          </>
        )}

        {nodeType === 'skill' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Skill</label>
              <input
                style={inputStyle}
                value={(config.skill as string) ?? ''}
                onChange={(e) => updateConfig('skill', e.target.value)}
                placeholder="skill-name"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Args</label>
              <input
                style={inputStyle}
                value={(config.args as string) ?? ''}
                onChange={(e) => updateConfig('args', e.target.value)}
              />
            </div>
          </>
        )}

        {nodeType === 'bash' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Command</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace', fontSize: '12px' }}
                value={(config.command as string) ?? ''}
                onChange={(e) => updateConfig('command', e.target.value)}
                placeholder="shell command"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Timeout (ms)</label>
              <input
                style={inputStyle}
                type="number"
                value={(config.timeout as number) ?? ''}
                onChange={(e) => updateConfig('timeout', e.target.value ? Number(e.target.value) : undefined)}
              />
            </div>
            <div style={sectionStyle}>
              <label style={{ ...labelStyle, display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={Boolean(config.run_in_background)}
                  onChange={(e) => updateConfig('run_in_background', e.target.checked)}
                />
                Run in background
              </label>
            </div>
          </>
        )}

        {nodeType === 'read' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>File Path</label>
              <input
                style={inputStyle}
                value={(config.file_path as string) ?? ''}
                onChange={(e) => updateConfig('file_path', e.target.value)}
                placeholder="/abs/path"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Offset / Limit</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  style={inputStyle}
                  type="number"
                  placeholder="offset"
                  value={(config.offset as number) ?? ''}
                  onChange={(e) => updateConfig('offset', e.target.value ? Number(e.target.value) : undefined)}
                />
                <input
                  style={inputStyle}
                  type="number"
                  placeholder="limit"
                  value={(config.limit as number) ?? ''}
                  onChange={(e) => updateConfig('limit', e.target.value ? Number(e.target.value) : undefined)}
                />
              </div>
            </div>
          </>
        )}

        {nodeType === 'edit' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>File Path</label>
              <input
                style={inputStyle}
                value={(config.file_path as string) ?? ''}
                onChange={(e) => updateConfig('file_path', e.target.value)}
                placeholder="/abs/path"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Old String</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace', fontSize: '12px' }}
                value={(config.old_string as string) ?? ''}
                onChange={(e) => updateConfig('old_string', e.target.value)}
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>New String</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace', fontSize: '12px' }}
                value={(config.new_string as string) ?? ''}
                onChange={(e) => updateConfig('new_string', e.target.value)}
              />
            </div>
          </>
        )}

        {nodeType === 'subflow' && (
          <div style={sectionStyle}>
            <label style={labelStyle}>Plan ID</label>
            <input
              style={inputStyle}
              value={(config.plan_id as string) ?? ''}
              onChange={(e) => updateConfig('plan_id', e.target.value)}
              placeholder="uuid of nested plan"
            />
          </div>
        )}

        {nodeType === 'parallel' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Nodes (comma-separated ids)</label>
              <input
                style={inputStyle}
                value={Array.isArray(config.nodes) ? (config.nodes as string[]).join(',') : ''}
                onChange={(e) => updateConfig('nodes', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Join Strategy</label>
              <select
                style={inputStyle}
                value={(config.joinStrategy as string) ?? 'all'}
                onChange={(e) => updateConfig('joinStrategy', e.target.value)}
              >
                <option value="all">all</option>
                <option value="any">any</option>
                <option value="race">race</option>
              </select>
            </div>
          </>
        )}

        {nodeType === 'decision' && (
          <>
            <div style={sectionStyle}>
              <label style={labelStyle}>Prompt</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
                value={(config.prompt as string) ?? ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                placeholder="decision prompt"
              />
            </div>
            <div style={sectionStyle}>
              <label style={labelStyle}>Options (JSON array)</label>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: '60px', fontFamily: 'monospace', fontSize: '12px' }}
                value={
                  config.options !== undefined
                    ? typeof config.options === 'string'
                      ? config.options
                      : JSON.stringify(config.options, null, 2)
                    : ''
                }
                onChange={(e) => {
                  try {
                    updateConfig('options', JSON.parse(e.target.value));
                  } catch {
                    updateConfig('options', e.target.value);
                  }
                }}
                placeholder='[{"value":"yes","label":"Yes"}]'
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
