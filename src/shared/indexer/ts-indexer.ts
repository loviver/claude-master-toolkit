import { Project, SyntaxKind, Node, type SourceFile } from 'ts-morph';
import { createHash } from 'crypto';
import { relative, resolve } from 'path';
import { qualifyId } from './ids.js';
import type { FileImport } from './types.js';

export interface IndexedSymbol {
  projectPath: string;
  file: string;
  symbol: string;
  kind: string;
  signature: string | null;
  startLine: number;
  endLine: number;
  exported: boolean;
  deps: string[];
  /** Call lines per resolved dep id (`file::symbol` → lines). Only tracked by the ts-morph indexer. */
  depSites?: Record<string, number[]>;
  /** Non-call references to in-project top-level symbols (types, consts…). Qualified `file::symbol`. */
  refs: string[];
  tokensEstimate: number;
  contentHash: string;
}

export interface IndexResult {
  files: number;
  symbols: number;
  elapsedMs: number;
  skipped: number;
}

const KIND_MAP: Record<number, string> = {
  [SyntaxKind.ClassDeclaration]: 'class',
  [SyntaxKind.FunctionDeclaration]: 'function',
  [SyntaxKind.MethodDeclaration]: 'method',
  [SyntaxKind.InterfaceDeclaration]: 'interface',
  [SyntaxKind.TypeAliasDeclaration]: 'type',
  [SyntaxKind.EnumDeclaration]: 'enum',
  [SyntaxKind.VariableDeclaration]: 'const',
};

const SIGNATURE_MAX = 200;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashContent(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function extractSignature(node: Node): string | null {
  const kind = node.getKind();
  try {
    if (kind === SyntaxKind.FunctionDeclaration || kind === SyntaxKind.MethodDeclaration) {
      const fn = node as any;
      const name = fn.getName?.() ?? '';
      const params = fn.getParameters?.().map((p: any) => p.getText()).join(', ') ?? '';
      const ret = fn.getReturnTypeNode?.()?.getText() ?? '';
      return `${name}(${params})${ret ? `: ${ret}` : ''}`;
    }
    if (kind === SyntaxKind.VariableDeclaration) {
      const init = (node as any).getInitializer?.();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = (node as any).getName?.() ?? '';
        const params = init.getParameters().map((p) => p.getText()).join(', ');
        const ret = init.getReturnTypeNode()?.getText() ?? '';
        return `${name}(${params})${ret ? `: ${ret}` : ''}`;
      }
      // `const useX: Hook<T> = impl` — the annotation IS the signature.
      const typeNode = (node as any).getTypeNode?.();
      return typeNode ? `${(node as any).getName?.() ?? ''}: ${typeNode.getText()}` : null;
    }
    if (kind === SyntaxKind.InterfaceDeclaration) {
      const itf = node as any;
      const members = (itf.getMembers?.() ?? [])
        .map((m: Node) => m.getText().replace(/\s+/g, ' ').replace(/[;,]$/, ''))
        .join('; ');
      const sig = `interface ${itf.getName?.() ?? ''}${members ? ` { ${members} }` : ''}`;
      return sig.length > SIGNATURE_MAX ? `${sig.slice(0, SIGNATURE_MAX - 1)}…` : sig;
    }
    if (kind === SyntaxKind.ClassDeclaration) {
      return `class ${(node as any).getName?.() ?? ''}`;
    }
    if (kind === SyntaxKind.TypeAliasDeclaration) {
      return (node as any).getText?.().split('\n')[0] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve a call's callee to the DECLARED name of the symbol it targets,
 * using the type-checker. For `svc.doThing()` this returns `doThing` (the
 * method), not `svc` (the receiver); for an imported `parseThing()` it follows
 * the import alias to the real declaration. Calls that resolve into a `.d.ts`
 * or `node_modules` are dropped — they are never in-project edges. When the
 * checker can't resolve (dynamic/`any` dispatch) we fall back to the BARE
 * syntactic last segment of the callee text — honest: we don't know its file.
 */
function resolveCallTarget(expr: Node, projectPath: string): string | null {
  try {
    const sym = Node.isPropertyAccessExpression(expr)
      ? expr.getNameNode().getSymbol()
      : expr.getSymbol();
    if (sym) {
      const target = sym.getAliasedSymbol() ?? sym;
      const decl = target.getDeclarations()[0];
      const fp = decl?.getSourceFile().getFilePath() ?? '';
      if (fp.endsWith('.d.ts') || fp.includes('node_modules')) return null;
      const name = target.getName();
      if (!name || name === '__type' || !/^[A-Za-z_]/.test(name)) return null;
      // Qualify with the target's file so same-named symbols don't collide.
      // No declaration file (rare builtin) → bare name.
      return fp ? qualifyId(relative(projectPath, fp), name) : name;
    }
  } catch {
    // fall through to syntactic extraction
  }
  const last = expr.getText().split('.').pop() ?? '';
  const root = last.split('(')[0];
  return root && /^[A-Za-z_]/.test(root) ? root : null;
}

/** `<div>` / `<svg>` are intrinsic elements, not project symbols. */
const isIntrinsicTag = (tag: Node): boolean => Node.isIdentifier(tag) && /^[a-z]/.test(tag.getText());

function extractDeps(node: Node, projectPath: string): { deps: string[]; sites: Record<string, number[]> } {
  const deps = new Set<string>();
  // Map, not a plain object: unresolved callees fall back to bare names like `toString`.
  const sites = new Map<string, number[]>();
  node.forEachDescendant((child) => {
    const kind = child.getKind();
    let expr: Node | undefined;
    if (kind === SyntaxKind.CallExpression || kind === SyntaxKind.NewExpression) {
      expr = (child as any).getExpression?.();
    } else if (kind === SyntaxKind.JsxOpeningElement || kind === SyntaxKind.JsxSelfClosingElement) {
      // A component rendered in JSX is a caller of that component.
      const tag = (child as any).getTagNameNode?.() as Node | undefined;
      if (tag && !isIntrinsicTag(tag)) expr = tag;
    }
    if (!expr) return;
    const resolved = resolveCallTarget(expr, projectPath);
    if (!resolved) return;
    deps.add(resolved);
    const line = child.getStartLineNumber();
    const lines = sites.get(resolved) ?? [];
    if (!lines.includes(line)) lines.push(line);
    sites.set(resolved, lines);
  });
  const kept = Array.from(deps).slice(0, 30);
  const keptSites: Record<string, number[]> = {};
  for (const id of kept) keptSites[id] = sites.get(id)!;
  return { deps: kept, sites: keptSites };
}

function isTopLevelDeclaration(decl: Node): boolean {
  const top = Node.isVariableDeclaration(decl) ? decl.getVariableStatement()?.getParent() : decl.getParent();
  return !!top && Node.isSourceFile(top);
}

/**
 * Resolve an identifier to the qualified id of an in-project TOP-LEVEL symbol.
 * Locals, members, builtins and `node_modules`/`.d.ts` declarations return null.
 */
function resolveRefTarget(id: Node, projectPath: string): string | null {
  try {
    const sym = id.getSymbol();
    if (!sym) return null;
    const target = sym.getAliasedSymbol() ?? sym;
    const decl = target.getDeclarations()[0];
    if (!decl || !isTopLevelDeclaration(decl)) return null;
    const fp = decl.getSourceFile().getFilePath();
    if (fp.endsWith('.d.ts') || fp.includes('node_modules')) return null;
    const name = target.getName();
    if (!name || !/^[A-Za-z_]/.test(name)) return null;
    return qualifyId(relative(projectPath, fp), name);
  } catch {
    return null;
  }
}

/**
 * Non-call references (type annotations, constants, enums…) to in-project
 * symbols. Kept apart from `deps` so call-edge blast radius isn't inflated by
 * type usage. Excludes the symbol itself and anything already a call edge.
 */
function extractRefs(node: Node, projectPath: string, ownId: string, deps: string[]): string[] {
  const refs = new Set<string>();
  const skip = new Set([ownId, ...deps]);
  for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const parent = id.getParent();
    // `obj.prop`: the property name is a member, never a top-level symbol.
    if (parent && Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) continue;
    const resolved = resolveRefTarget(id, projectPath);
    if (resolved && !skip.has(resolved)) refs.add(resolved);
  }
  return Array.from(refs).slice(0, 50);
}

export function collectImports(sourceFile: SourceFile): FileImport[] {
  return sourceFile.getImportDeclarations().map((imp) => {
    const module = imp.getModuleSpecifierValue();
    const names: string[] = [];
    const def = imp.getDefaultImport();
    if (def) names.push(def.getText());
    const ns = imp.getNamespaceImport();
    if (ns) names.push(`* as ${ns.getText()}`);
    for (const n of imp.getNamedImports()) names.push(n.getName());
    const resolved = imp.getModuleSpecifierSourceFile();
    const external = resolved
      ? resolved.getFilePath().includes('node_modules') || resolved.getFilePath().endsWith('.d.ts')
      : !module.startsWith('.');
    return { module, names, external };
  });
}

export function collectSymbols(
  sourceFile: SourceFile,
  projectPath: string,
  filePath: string,
): IndexedSymbol[] {
  const out: IndexedSymbol[] = [];
  const relFile = relative(projectPath, filePath);

  const pushSymbol = (node: Node, name: string, kind: string, exported: boolean) => {
    const text = node.getText();
    const { deps, sites } = extractDeps(node, projectPath);
    out.push({
      projectPath,
      file: relFile,
      symbol: name,
      kind,
      signature: extractSignature(node),
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      exported,
      deps,
      depSites: sites,
      refs: extractRefs(node, projectPath, qualifyId(relFile, name), deps),
      tokensEstimate: estimateTokens(text),
      contentHash: hashContent(text),
    });
  };

  sourceFile.forEachChild((node) => {
    const kind = node.getKind();
    const kindName = KIND_MAP[kind];
    if (!kindName) return;

    const isExported = (node as any).isExported?.() ?? false;

    if (kind === SyntaxKind.VariableStatement) return;

    if (kind === SyntaxKind.ClassDeclaration) {
      const cls = node as any;
      const name = cls.getName?.();
      if (!name) return;
      pushSymbol(node, name, 'class', isExported);
      cls.getMethods?.().forEach((m: any) => {
        pushSymbol(m, `${name}.${m.getName()}`, 'method', false);
      });
      return;
    }

    const name = (node as any).getName?.();
    if (name) pushSymbol(node, name, kindName, isExported);
  });

  sourceFile.getVariableStatements().forEach((vs) => {
    const isExported = vs.isExported();
    vs.getDeclarations().forEach((d) => {
      const name = d.getName();
      if (!name) return;
      const init = d.getInitializer();
      const kind = init && [
        SyntaxKind.ArrowFunction,
        SyntaxKind.FunctionExpression,
      ].includes(init.getKind()) ? 'function' : 'const';
      pushSymbol(d, name, kind, isExported);
    });
  });

  return out;
}

function createProject(absRoot: string): Project {
  return new Project({
    tsConfigFilePath: `${absRoot}/tsconfig.json`,
    skipAddingFilesFromTsConfig: false,
    // Resolve import graph so the type-checker can follow aliases to real
    // declarations — required for precise dep/caller edges (not name strings).
    skipFileDependencyResolution: false,
  });
}

export interface ProjectSourceFiles {
  absRoot: string;
  files: string[];
  extract: (absPath: string) => IndexedSymbol[];
  imports: (absPath: string) => FileImport[];
}

const TS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function isTsFile(file: string): boolean {
  const dot = file.lastIndexOf('.');
  return dot >= 0 && TS_EXTS.has(file.slice(dot));
}

export function openTsProject(projectPath: string): ProjectSourceFiles {
  const absRoot = resolve(projectPath);
  const project = createProject(absRoot);

  const files = project.getSourceFiles()
    .map((sf) => sf.getFilePath() as string)
    .filter((p) => !p.includes('node_modules') && !p.includes('dist/'));

  const extract = (absPath: string): IndexedSymbol[] => {
    const sf = project.getSourceFile(absPath);
    if (!sf) return [];
    return collectSymbols(sf, absRoot, absPath);
  };

  const imports = (absPath: string): FileImport[] => {
    const sf = project.getSourceFile(absPath);
    return sf ? collectImports(sf) : [];
  };

  return { absRoot, files, extract, imports };
}

export function indexProject(projectPath: string): {
  symbols: IndexedSymbol[];
  result: IndexResult;
} {
  const start = Date.now();
  const { absRoot, files, extract } = openTsProject(projectPath);

  const allSymbols: IndexedSymbol[] = [];
  let skipped = 0;

  for (const file of files) {
    try {
      allSymbols.push(...extract(file));
    } catch {
      skipped++;
    }
  }

  void absRoot;
  return {
    symbols: allSymbols,
    result: {
      files: files.length,
      symbols: allSymbols.length,
      elapsedMs: Date.now() - start,
      skipped,
    },
  };
}
