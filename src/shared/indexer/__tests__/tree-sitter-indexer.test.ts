import { describe, it, expect } from 'vitest';
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
    expect(pub.deps).toContain('helper');
  });
});
