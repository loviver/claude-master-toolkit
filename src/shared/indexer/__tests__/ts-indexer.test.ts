import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { collectSymbols } from '../ts-indexer.js';

function mkProject(): Project {
  // In-memory FS so imports resolve via the real type-checker without touching disk.
  return new Project({ useInMemoryFileSystem: true });
}

function depsOf(syms: ReturnType<typeof collectSymbols>, name: string): string[] {
  const s = syms.find((x) => x.symbol === name);
  if (!s) throw new Error(`symbol ${name} not found`);
  return s.deps;
}

describe('ts-indexer dep resolution', () => {
  it('records the method actually called, qualified by its file — not the receiver', () => {
    const p = mkProject();
    p.createSourceFile('/svc.ts', `export class Svc { doThing() { return 1; } }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { Svc } from './svc';\n` +
        `export function run() { const s = new Svc(); return s.doThing(); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('svc.ts::doThing');
    expect(deps).not.toContain('s'); // receiver must NOT be recorded
  });

  it('resolves an imported function to its declared, file-qualified id', () => {
    const p = mkProject();
    p.createSourceFile('/util.ts', `export function parseThing() { return 2; }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { parseThing } from './util';\nexport function run() { return parseThing(); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('util.ts::parseThing');
  });

  it('disambiguates a same-named symbol to the CORRECT file (collision proof)', () => {
    const p = mkProject();
    p.createSourceFile('/a.ts', `export function helper() { return 'a'; }`);
    p.createSourceFile('/b.ts', `export function helper() { return 'b'; }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { helper } from './a';\nexport function run() { return helper(); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('a.ts::helper');
    expect(deps).not.toContain('b.ts::helper');
  });

  it('drops external / stdlib calls — they are not in-project edges', () => {
    const p = mkProject();
    const main = p.createSourceFile(
      '/main.ts',
      `export function run() { return JSON.parse('{}'); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).not.toContain('JSON');
    expect(deps).not.toContain('parse');
    expect(deps.some((d) => d.includes('parse'))).toBe(false);
  });

  it('falls back to the bare syntactic name when the call cannot be resolved', () => {
    const p = mkProject();
    const main = p.createSourceFile(
      '/main.ts',
      `export function run() { return (globalThis as any).mystery(); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('mystery'); // bare — no file known for dynamic dispatch
  });

  it('resolves a local function call in the same file, qualified to that file', () => {
    const p = mkProject();
    const main = p.createSourceFile(
      '/main.ts',
      `function helper() { return 1; }\nexport function run() { return helper(); }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('main.ts::helper');
  });
});

// ─── Phase 2: coverage (signatures, JSX, new, refs, imports) ───

import { collectImports } from '../ts-indexer.js';

function mkTsxProject(): Project {
  return new Project({ useInMemoryFileSystem: true, compilerOptions: { jsx: 4 } });
}

function symOf(syms: ReturnType<typeof collectSymbols>, name: string) {
  const s = syms.find((x) => x.symbol === name);
  if (!s) throw new Error(`symbol ${name} not found`);
  return s;
}

describe('ts-indexer signatures', () => {
  it('extracts a signature for an arrow-function const', () => {
    const p = mkProject();
    const f = p.createSourceFile(
      '/fmt.ts',
      `export const formatDate = (d: Date, f?: string): string => '';`,
    );
    expect(symOf(collectSymbols(f, '/', '/fmt.ts'), 'formatDate').signature).toBe(
      'formatDate(d: Date, f?: string): string',
    );
  });

  it('falls back to the declared type for a non-function const', () => {
    const p = mkProject();
    const f = p.createSourceFile(
      '/hooks.ts',
      `declare const useSelector: any;\ntype Hook<T> = (s: T) => unknown;\nexport const useSel: Hook<number> = useSelector;\nexport const LIMIT = 5;`,
    );
    const syms = collectSymbols(f, '/', '/hooks.ts');
    expect(symOf(syms, 'useSel').signature).toBe('useSel: Hook<number>');
    expect(symOf(syms, 'LIMIT').signature).toBeNull();
  });

  it('gives an interface its members on one line, truncated to 200 chars', () => {
    const p = mkProject();
    const long = Array.from({ length: 40 }, (_, i) => `field${i}: string;`).join('\n');
    const f = p.createSourceFile(
      '/t.ts',
      `export interface Small { page: number; q: string }\nexport interface Big {\n${long}\n}`,
    );
    const syms = collectSymbols(f, '/', '/t.ts');
    const small = symOf(syms, 'Small').signature!;
    expect(small).toContain('interface Small');
    expect(small).toContain('page: number');
    expect(small).not.toContain('\n');
    expect(symOf(syms, 'Big').signature!.length).toBeLessThanOrEqual(200);
  });
});

describe('ts-indexer JSX and new edges', () => {
  it('records a JSX component usage as a file-qualified dep, ignoring intrinsic tags', () => {
    const p = mkTsxProject();
    p.createSourceFile('/foo.tsx', `export function Foo() { return null; }`);
    const main = p.createSourceFile(
      '/main.tsx',
      `import { Foo } from './foo';\nexport function App() { return <div><Foo /></div>; }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.tsx'), 'App');
    expect(deps).toContain('foo.tsx::Foo');
    expect(deps).not.toContain('div');
  });

  it('records `new X()` for an in-project class but drops builtins', () => {
    const p = mkProject();
    p.createSourceFile('/svc.ts', `export class Svc {}`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { Svc } from './svc';\nexport function run() { return [new Svc(), new Map()]; }`,
    );
    const deps = depsOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(deps).toContain('svc.ts::Svc');
    expect(deps).not.toContain('Map');
  });
});

describe('ts-indexer refs (non-call references)', () => {
  it('records a type annotation as a ref, not a dep', () => {
    const p = mkProject();
    p.createSourceFile('/types.ts', `export interface Filters { a: number }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { Filters } from './types';\nexport function use(f: Filters) { return f; }`,
    );
    const s = symOf(collectSymbols(main, '/', '/main.ts'), 'use');
    expect(s.refs).toContain('types.ts::Filters');
    expect(s.deps).not.toContain('types.ts::Filters');
  });

  it('records an imported constant identifier as a ref', () => {
    const p = mkProject();
    p.createSourceFile('/c.ts', `export const COLORS = { a: 1 };`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { COLORS } from './c';\nexport function pick() { return COLORS.a; }`,
    );
    expect(symOf(collectSymbols(main, '/', '/main.ts'), 'pick').refs).toContain('c.ts::COLORS');
  });

  it('does not record locals, builtins, call targets or the symbol itself', () => {
    const p = mkProject();
    p.createSourceFile('/u.ts', `export function helper() { return 1; }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { helper } from './u';\n` +
        `export function run(): number { const x = 1; return x + Math.max(1, 2) + helper(); }`,
    );
    const s = symOf(collectSymbols(main, '/', '/main.ts'), 'run');
    expect(s.refs).toEqual([]);
    expect(s.deps).toContain('u.ts::helper');
  });
});

describe('collectImports', () => {
  it('lists module, imported names and external flag per import', () => {
    const p = mkProject();
    p.createSourceFile('/foo.ts', `export const Foo = 1;`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { useState } from 'react';\nimport Def, * as ns from 'lib';\nimport { Foo } from './foo';\nexport const x = 1;`,
    );
    expect(collectImports(main)).toEqual([
      { module: 'react', names: ['useState'], external: true },
      { module: 'lib', names: ['Def', '* as ns'], external: true },
      { module: './foo', names: ['Foo'], external: false },
    ]);
  });
});

describe('ts-indexer call sites', () => {
  it('records every call line per resolved dep, so callers can point at the call', () => {
    const p = mkProject();
    p.createSourceFile('/util.ts', `export function pick() { return 1; }`);
    const main = p.createSourceFile(
      '/main.ts',
      `import { pick } from './util';\n` +
        `export function run() {\n` +
        `  const a = pick();\n` +
        `  if (a) return pick();\n` +
        `  return 0;\n` +
        `}`,
    );
    const run = collectSymbols(main, '/', '/main.ts').find((x) => x.symbol === 'run');
    expect(run?.depSites?.['util.ts::pick']).toEqual([3, 4]);
  });

  it('does not choke on unresolved calls named like Object.prototype members', () => {
    const p = mkProject();
    const main = p.createSourceFile(
      '/main.ts',
      `export function run(x: any) {\n  return x.toString() + x.hasOwnProperty('a') + x.valueOf();\n}`,
    );
    const run = collectSymbols(main, '/', '/main.ts').find((s) => s.symbol === 'run');
    expect(run?.depSites?.['toString']).toEqual([2]);
    expect(run?.depSites?.['hasOwnProperty']).toEqual([2]);
  });
});
