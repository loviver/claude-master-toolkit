import { Node, type Project, type SourceFile } from 'ts-morph';
import { join, relative } from 'path';
import type { Expectation } from './codex.js';

/**
 * Ground-truth oracle for bench tasks, computed with the TypeScript type-checker (ts-morph)
 * instead of text search: alias imports resolve, same-named symbols in other files do not
 * leak in, and JSX renders count as usages. Keeps `tasks.json` honest as the code moves.
 */
export type OracleSpec =
  /** Files that declare a top-level symbol with this name. */
  | { type: 'definedIn'; symbol: string }
  /** Files that call (or render as JSX) the declaration of `symbol` in `file`, excluding `file`. */
  | { type: 'callers'; symbol: string; file: string }
  /** Files that import from `file`. */
  | { type: 'importers'; file: string };

const isTestPath = (p: string) => p.includes('__tests__/') || /\.test\.tsx?$/.test(p);

function inScope(root: string, sf: SourceFile): string | null {
  const rel = relative(root, sf.getFilePath());
  return rel.startsWith('src/') && !isTestPath(rel) ? rel : null;
}

const sorted = (set: Set<string>) => [...set].sort();

function declarationIn(sf: SourceFile, symbol: string) {
  return (
    sf.getFunction(symbol) ??
    sf.getVariableDeclaration(symbol) ??
    sf.getClass(symbol) ??
    sf.getInterface(symbol) ??
    sf.getTypeAlias(symbol)
  );
}

/** A reference that invokes the symbol: `f()`, `new F()`, `<F />` / `<F>`. */
function isUsage(node: Node): boolean {
  const parent = node.getParent();
  if (!parent) return false;
  if (Node.isCallExpression(parent) || Node.isNewExpression(parent)) return parent.getExpression() === node;
  if (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) return parent.getTagNameNode() === node;
  return false;
}

export function computeOracle(project: Project, root: string, spec: OracleSpec): string[] {
  const out = new Set<string>();

  if (spec.type === 'definedIn') {
    for (const sf of project.getSourceFiles()) {
      const rel = inScope(root, sf);
      if (rel && declarationIn(sf, spec.symbol)) out.add(rel);
    }
    return sorted(out);
  }

  const target = project.getSourceFile(join(root, spec.file));
  if (!target) throw new Error(`oracle: ${spec.file} is not part of the project`);

  if (spec.type === 'importers') {
    for (const sf of project.getSourceFiles()) {
      const rel = inScope(root, sf);
      if (!rel || sf === target) continue;
      const decls = [...sf.getImportDeclarations(), ...sf.getExportDeclarations()];
      if (decls.some((d) => d.getModuleSpecifierSourceFile() === target)) out.add(rel);
    }
    return sorted(out);
  }

  const decl = declarationIn(target, spec.symbol);
  const nameNode = decl && 'getNameNode' in decl ? decl.getNameNode() : undefined;
  if (!nameNode || !Node.isIdentifier(nameNode)) throw new Error(`oracle: ${spec.symbol} not declared in ${spec.file}`);
  // findReferences follows the symbol through import aliases (`import { f as g }`).
  for (const group of nameNode.findReferences()) {
    for (const ref of group.getReferences()) {
      const node = ref.getNode();
      const rel = inScope(root, node.getSourceFile());
      if (rel && node.getSourceFile() !== target && isUsage(node)) out.add(rel);
    }
  }
  return sorted(out);
}

export interface ExpectationCheck {
  ok: boolean;
  /** True answers the task's `expect.all` omits. */
  missing: string[];
  /** Entries in `expect.all` the code no longer supports. */
  extra: string[];
  /** `expect.none` decoys that are in fact part of the truth. */
  decoysInTruth: string[];
}

export function checkExpectation(expect: Expectation, truth: string[]): ExpectationCheck {
  const truthSet = new Set(truth);
  const missing = truth.filter((t) => !expect.all.includes(t));
  const extra = expect.all.filter((e) => !truthSet.has(e));
  const decoysInTruth = (expect.none ?? []).filter((d) => truthSet.has(d));
  return { ok: !missing.length && !extra.length && !decoysInTruth.length, missing, extra, decoysInTruth };
}
