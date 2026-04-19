import { Graph } from './graph.js';

export function buildCtkGraph(): Graph {
  const g = new Graph();
  g.add('pandorica', []);
  g.add('sdd', ['pandorica']);
  g.add('skills', ['sdd']);
  g.add('persona', []);
  g.add('hooks', ['pandorica']);
  g.add('model-routing', []);

  // Soft ordering: persona writes the base prompt file before others append.
  g.addSoftOrder('persona', 'pandorica');
  g.addSoftOrder('persona', 'sdd');
  return g;
}

export const CTK_COMPONENTS: readonly string[] = [
  'pandorica',
  'sdd',
  'skills',
  'persona',
  'hooks',
  'model-routing',
];
