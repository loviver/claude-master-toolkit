// ── Memory classification ──

export type MemoryType = 'bugfix' | 'decision' | 'architecture' | 'discovery' | 'pattern' | 'config' | 'preference';

// ── Pandorica memory vault entry ──

export interface Memory {
  id: string;
  title: string;
  type: MemoryType;
  scope: 'project' | 'personal';
  topicKey?: string;
  content: string;
  projectPath?: string;
  sessionId?: string;
  createdAt: number;
  updatedAt: number;
}
