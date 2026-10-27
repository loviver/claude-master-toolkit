import { describe, expect, it } from 'vitest';
import type { CodeGraphNodeDTO } from '../../../../lib/types';
import { buildClassModel } from '../class-model';
import { callTreeChildren, isRecursive } from '../call-tree-model';

const node = (id: string, kind: string, extra: Partial<CodeGraphNodeDTO> = {}): CodeGraphNodeDTO => ({
  id, label: id.split('::')[1], kind, file: id.split('::')[0], group: 'src', rank: 0, size: 1,
  exported: true, signature: null, startLine: 1, endLine: 2, indexedAt: 0, ...extra,
});
const link = (source: string, target: string, type: 'call' | 'ref' | 'inherit' | 'dispatch') => ({ source, target, type, weight: 1 });

describe('buildClassModel', () => {
  const nodes = [
    node('f.ts::Base', 'class'),
    node('f.ts::Sub', 'class'),
    node('f.ts::Sub.run', 'method', { signature: 'run(): void' }),
    node('f.ts::Sub.stop', 'method'),
    node('g.ts::helper', 'function'),
  ];

  it('groups members under their owner, one box per class', () => {
    const m = buildClassModel(nodes, []);
    expect(m.boxes.map((b) => b.id).sort()).toEqual(['f.ts::Base', 'f.ts::Sub']);
    const sub = m.boxes.find((b) => b.id === 'f.ts::Sub')!;
    expect(sub.members.map((x) => x.name)).toEqual(['run', 'stop']);
    expect(sub.members[0].signature).toBe('run(): void');
  });

  it('draws inheritance as supertype-first edges between boxes', () => {
    const m = buildClassModel(nodes, [link('f.ts::Sub', 'f.ts::Base', 'inherit')]);
    expect(m.inherits).toEqual([{ sub: 'f.ts::Sub', base: 'f.ts::Base' }]);
  });

  it('aggregates member calls into class-to-class uses and drops self calls', () => {
    const m = buildClassModel(nodes, [
      link('f.ts::Sub.run', 'f.ts::Base', 'call'),
      link('f.ts::Sub.run', 'f.ts::Sub.stop', 'call'),
    ]);
    expect(m.uses).toEqual([{ from: 'f.ts::Sub', to: 'f.ts::Base', weight: 1 }]);
  });
});

describe('call tree', () => {
  const u = (id: string) => ({ id, symbol: id, kind: 'function', file: 'f.ts', startLine: 1, endLine: 2, lines: [] });
  const dto = { callers: [u('c1')], callees: [u('d1'), u('d2')] } as never;

  it('lists callers for incoming and callees for outgoing', () => {
    expect(callTreeChildren(dto, 'incoming').map((x) => x.id)).toEqual(['c1']);
    expect(callTreeChildren(dto, 'outgoing').map((x) => x.id)).toEqual(['d1', 'd2']);
  });

  it('detects recursion along the path', () => {
    expect(isRecursive(['a', 'b'], 'a')).toBe(true);
    expect(isRecursive(['a', 'b'], 'c')).toBe(false);
  });
});
