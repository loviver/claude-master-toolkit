import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TreeSitterIndexer } from '../tree-sitter-indexer.js';

const PY = `
def public_fn(x):
    return helper(x)

def _private_fn():
    pass

class MyClass:
    def method_a(self):
        return 1
    def _secret(self):
        return 2

def helper(z):
    return z
`;

const GO = `
package main

func PublicFn(x int) int { return helper(x) }
func helper(z int) int { return z }
type User struct { Name string }
func (u *User) Greet() string { return u.Name }
`;

const RS = `
pub fn public_fn(x: i32) -> i32 { helper(x) }
fn helper(z: i32) -> i32 { z }
pub struct User { name: String }
impl User {
    pub fn greet(&self) -> &str { &self.name }
    fn secret(&self) -> i32 { 0 }
}
`;

describe('TreeSitterIndexer', () => {
  const idx = new TreeSitterIndexer();

  it('handles .py/.go/.rs only', () => {
    expect(idx.canHandle('/x/a.py')).toBe(true);
    expect(idx.canHandle('/x/a.go')).toBe(true);
    expect(idx.canHandle('/x/a.rs')).toBe(true);
    expect(idx.canHandle('/x/a.ts')).toBe(false);
  });

  it('extracts Python symbols with correct export heuristic', () => {
    const syms = idx.extractFromFile('/proj', '/proj/sample.py', PY);
    const byName = Object.fromEntries(syms.map((s) => [s.symbol, s]));

    expect(byName['public_fn']).toBeDefined();
    expect(byName['public_fn'].exported).toBe(true);
    expect(byName['public_fn'].kind).toBe('function');

    expect(byName['_private_fn'].exported).toBe(false);

    expect(byName['MyClass'].kind).toBe('class');
    expect(byName['MyClass'].exported).toBe(true);

    expect(byName['MyClass.method_a'].kind).toBe('method');
    expect(byName['MyClass.method_a'].exported).toBe(true);
    expect(byName['MyClass._secret'].exported).toBe(false);
  });

  it('extracts Go symbols with uppercase export rule', () => {
    const syms = idx.extractFromFile('/proj', '/proj/sample.go', GO);
    const byName = Object.fromEntries(syms.map((s) => [s.symbol, s]));

    expect(byName['PublicFn'].exported).toBe(true);
    expect(byName['helper'].exported).toBe(false);
    expect(byName['User'].kind).toBe('type');
    expect(byName['User'].exported).toBe(true);
    expect(byName['Greet'].kind).toBe('method');
    expect(byName['Greet'].exported).toBe(true);
  });

  it('extracts Rust symbols with pub visibility rule', () => {
    const syms = idx.extractFromFile('/proj', '/proj/sample.rs', RS);
    const fn = syms.find((s) => s.symbol === 'public_fn' && s.kind === 'function')!;
    const helper = syms.find((s) => s.symbol === 'helper')!;
    const struct = syms.find((s) => s.kind === 'struct' && s.symbol === 'User')!;
    const greet = syms.find((s) => s.symbol === 'User.greet')!;

    expect(fn.exported).toBe(true);
    expect(helper.exported).toBe(false);
    expect(struct.exported).toBe(true);
    expect(greet.kind).toBe('method');
    expect(greet.exported).toBe(true);
  });

  it('captures deps approximately', () => {
    const syms = idx.extractFromFile('/proj', '/proj/sample.py', PY);
    const pub = syms.find((s) => s.symbol === 'public_fn')!;
    expect(pub.deps).toContain('sample.py::helper');
  });

  it('parses Python files larger than the 32KB tree-sitter default buffer', () => {
    const filler = Array.from({ length: 2500 }, (_, i) => `def fn_${i}(a, b):\n    return a + b\n`).join('\n');
    expect(filler.length).toBeGreaterThan(70_000);
    const syms = idx.extractFromFile('/proj', '/proj/big.py', filler);
    expect(syms.length).toBe(2500);
    expect(syms.some((s) => s.symbol === 'fn_2499')).toBe(true);
  });
});

describe('TreeSitterIndexer — Python import resolution', () => {
  const idx = new TreeSitterIndexer();
  let root: string;
  const put = (rel: string, body: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  const extract = (rel: string, body: string) => idx.extractFromFile(root, join(root, rel), body);

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ctk-py-'));
    put('src/__init__.py', '');
    put('src/database/__init__.py', '');
    put('src/database/models.py', 'class Order:\n    pass\n');
    put('src/shipment/__init__.py', '');
    put('src/shipment/repository.py', 'class Repo:\n    def get(self):\n        pass\n\ndef load():\n    pass\n');
    put('src/presettlement/__init__.py', '');
    put('src/presettlement/schemas.py', 'class Schema:\n    pass\n');
    put('src/presettlement/service.py', '');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('resolves `from pkg.mod import X` calls to file::symbol', () => {
    const syms = extract('src/presettlement/service.py',
      'from src.shipment.repository import load, Repo\n\ndef run():\n    load()\n    Repo.get()\n');
    const run = syms.find((s) => s.symbol === 'run')!;
    expect(run.deps).toContain('src/shipment/repository.py::load');
    expect(run.deps).toContain('src/shipment/repository.py::Repo.get');
  });

  it('resolves relative imports (. and ..)', () => {
    const syms = extract('src/presettlement/service.py',
      'from .schemas import Schema\nfrom ..database.models import Order\n\ndef run():\n    Schema()\n    Order()\n');
    const run = syms.find((s) => s.symbol === 'run')!;
    expect(run.deps).toContain('src/presettlement/schemas.py::Schema');
    expect(run.deps).toContain('src/database/models.py::Order');
  });

  it('resolves module aliases: import a.b as m; m.f()', () => {
    const syms = extract('src/presettlement/service.py',
      'import src.shipment.repository as repo\nfrom src.database import models\n\ndef run():\n    repo.load()\n    models.Order()\n');
    const run = syms.find((s) => s.symbol === 'run')!;
    expect(run.deps).toContain('src/shipment/repository.py::load');
    expect(run.deps).toContain('src/database/models.py::Order');
  });

  it('qualifies same-file calls and self.method calls', () => {
    const syms = extract('src/presettlement/service.py',
      'def helper():\n    pass\n\nclass Svc:\n    def a(self):\n        self.b()\n        helper()\n    def b(self):\n        pass\n');
    const a = syms.find((s) => s.symbol === 'Svc.a')!;
    expect(a.deps).toContain('src/presettlement/service.py::Svc.b');
    expect(a.deps).toContain('src/presettlement/service.py::helper');
  });

  it('drops builtins and third-party calls instead of leaving bare ids', () => {
    const syms = extract('src/presettlement/service.py',
      'import requests\n\ndef run():\n    len([])\n    requests.get("x")\n');
    const run = syms.find((s) => s.symbol === 'run')!;
    expect(run.deps).toEqual([]);
  });

  it('records resolved base classes as heritage', () => {
    const syms = extract('src/presettlement/service.py',
      'from .schemas import Schema\n\nclass Child(Schema):\n    pass\n');
    expect(syms.find((s) => s.symbol === 'Child')!.heritage).toEqual(['src/presettlement/schemas.py::Schema']);
  });
});
