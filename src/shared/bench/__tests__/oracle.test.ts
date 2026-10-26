import { describe, it, expect, beforeAll } from 'vitest';
import { Project, ts } from 'ts-morph';
import { computeOracle, checkExpectation } from '../oracle.js';

let project: Project;

beforeAll(() => {
  project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, strict: true },
  });
  const files: Record<string, string> = {
    '/src/a.ts': `export function helper() { return 1; }`,
    '/src/b.ts': `import { helper } from './a';\nexport function useB() { return helper(); }`,
    '/src/c.ts': `import { helper as h } from './a';\nexport const run = () => h();`,
    '/src/mention.ts': `import { helper } from './a';\nexport const ref = helper;`,
    '/src/d.ts': `export function helper() { return 2; }`,
    '/src/e.ts': `import { helper } from './d';\nhelper();`,
    '/src/__tests__/a.test.ts': `import { helper } from '../a';\nhelper();`,
    '/src/View.tsx': `export function View() { return null; }`,
    '/src/Page.tsx': `import { View } from './View';\nexport const Page = () => <View />;`,
  };
  for (const [path, text] of Object.entries(files)) project.createSourceFile(path, text);
});

describe('computeOracle', () => {
  it('definedIn lists every file declaring the name (homonyms included)', () => {
    expect(computeOracle(project, '/', { type: 'definedIn', symbol: 'helper' })).toEqual(['src/a.ts', 'src/d.ts']);
  });

  it('callers resolves through the type-checker: alias imports count, homonyms and tests do not', () => {
    expect(computeOracle(project, '/', { type: 'callers', symbol: 'helper', file: 'src/a.ts' })).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('callers counts JSX renders of a component', () => {
    expect(computeOracle(project, '/', { type: 'callers', symbol: 'View', file: 'src/View.tsx' })).toEqual(['src/Page.tsx']);
  });

  it('importers lists files importing the module, excluding tests', () => {
    expect(computeOracle(project, '/', { type: 'importers', file: 'src/a.ts' })).toEqual(['src/b.ts', 'src/c.ts', 'src/mention.ts']);
  });
});

describe('checkExpectation', () => {
  it('passes when expect.all is exactly the truth and decoys are absent from it', () => {
    expect(checkExpectation({ all: ['src/b.ts', 'src/c.ts'], none: ['src/e.ts'] }, ['src/b.ts', 'src/c.ts']).ok).toBe(true);
  });

  it('reports missing, extra and decoys-that-are-actually-true', () => {
    const r = checkExpectation({ all: ['src/b.ts', 'src/x.ts'], none: ['src/c.ts'] }, ['src/b.ts', 'src/c.ts']);
    expect(r).toEqual({ ok: false, missing: ['src/c.ts'], extra: ['src/x.ts'], decoysInTruth: ['src/c.ts'] });
  });
});
