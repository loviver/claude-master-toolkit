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
