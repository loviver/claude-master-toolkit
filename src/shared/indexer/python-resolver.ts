import { existsSync } from 'fs';
import { dirname, join, posix } from 'path';
import type Parser from 'tree-sitter';
import { qualifyId } from './ids.js';

/**
 * Cross-file name resolution for Python, the counterpart of what ts-morph gives the TS
 * indexer for free. Pure syntax + `existsSync`: it maps the names a file imports to the
 * project-relative file that defines them, so a call `load()` becomes `repo.py::load`
 * (a qualified id the symbol graph can link) instead of a bare `load` it must drop.
 *
 * Scope: top-level imports, relative imports, `import a.b as m`, `from pkg import module`.
 * Not followed: re-exports through `__init__.py`, star imports, runtime `importlib`.
 */

/** Directories tried as import roots, in order (`from src.x import y` vs `from x import y`). */
const SOURCE_ROOTS = ['', 'src'];

type Binding =
  | { kind: 'symbol'; file: string; symbol: string }
  | { kind: 'module'; file: string };

export interface PythonResolver {
  /** Qualified dep id for a call target like `load`, `repo.load`, `self.run`; null if not in-project. */
  resolveCall(callee: string, classContext: string | null): string | null;
  /** Qualified id of a base class expression (`Schema`, `models.Base`); null if not in-project. */
  resolveType(expr: string): string | null;
}

const fieldOf = (n: Parser.SyntaxNode, f: string) => n.childForFieldName(f);

export function buildPythonResolver(
  projectPath: string,
  relFile: string,
  root: Parser.SyntaxNode,
  topLevelSymbols: Set<string>,
  classMembers: Map<string, Set<string>>,
): PythonResolver {
  const fileExists = (rel: string) => existsSync(join(projectPath, rel));
  const fileDir = posix.dirname(relFile.split('\\').join('/'));

  /** `a.b.c` (or the package dir for `a.b`) → project-relative .py file, or null. */
  const moduleFile = (base: string): string | null => {
    for (const cand of [`${base}.py`, `${base}/__init__.py`]) if (fileExists(cand)) return cand;
    return null;
  };

  const resolveModule = (dotted: string, level: number): string | null => {
    const parts = dotted ? dotted.split('.') : [];
    if (level > 0) {
      let dir = fileDir;
      for (let i = 1; i < level; i++) dir = dirname(dir);
      return moduleFile(posix.join(dir, ...parts));
    }
    for (const r of SOURCE_ROOTS) {
      const hit = moduleFile(posix.join(r, ...parts));
      if (hit) return hit;
    }
    return null;
  };

  /** Submodule `pkg/name.py` of an imported-from package, if the imported name is one. */
  const submodule = (pkgFile: string, name: string): string | null => {
    if (!pkgFile.endsWith('__init__.py')) return null;
    return moduleFile(posix.join(dirname(pkgFile), name));
  };

  const bindings = new Map<string, Binding>();
  /** `import a.b.c` binds the dotted prefix, not just `a`. */
  const dottedModules = new Map<string, string>();

  const dottedText = (n: Parser.SyntaxNode) => n.text.replace(/\s+/g, '');

  const handleImport = (node: Parser.SyntaxNode) => {
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name') {
        const file = resolveModule(dottedText(child), 0);
        if (file) dottedModules.set(dottedText(child), file);
      } else if (child.type === 'aliased_import') {
        const name = fieldOf(child, 'name');
        const alias = fieldOf(child, 'alias');
        const file = name ? resolveModule(dottedText(name), 0) : null;
        if (file && alias) bindings.set(alias.text, { kind: 'module', file });
      }
    }
  };

  const handleFrom = (node: Parser.SyntaxNode) => {
    const mod = fieldOf(node, 'module_name');
    if (!mod) return;
    let level = 0;
    let dotted = '';
    if (mod.type === 'relative_import') {
      level = mod.namedChildren.find((c) => c.type === 'import_prefix')?.text.length ?? 0;
      dotted = dottedText(mod.namedChildren.find((c) => c.type === 'dotted_name') ?? mod).replace(/^\.+/, '');
    } else {
      dotted = dottedText(mod);
    }
    const file = resolveModule(dotted, level);
    if (!file) return;
    for (const imp of node.namedChildren) {
      if (imp === mod) continue;
      const nameNode = imp.type === 'aliased_import' ? fieldOf(imp, 'name') : imp;
      const aliasNode = imp.type === 'aliased_import' ? fieldOf(imp, 'alias') : null;
      if (!nameNode || (nameNode.type !== 'dotted_name' && nameNode.type !== 'identifier')) continue;
      const name = nameNode.text;
      const local = aliasNode?.text ?? name;
      const sub = submodule(file, name);
      bindings.set(local, sub ? { kind: 'module', file: sub } : { kind: 'symbol', file, symbol: name });
    }
  };

  const collect = (n: Parser.SyntaxNode) => {
    if (n.type === 'import_statement') return handleImport(n);
    if (n.type === 'import_from_statement') return handleFrom(n);
    for (const c of n.namedChildren) collect(c);
  };
  collect(root);

  const resolveDotted = (parts: string[]): string | null => {
    // `import a.b.c` → a.b.c.f(): longest registered dotted prefix wins.
    for (let i = parts.length - 1; i >= 1; i--) {
      const file = dottedModules.get(parts.slice(0, i).join('.'));
      if (file) return qualify(file, parts.slice(i));
    }
    const head = bindings.get(parts[0]);
    if (head?.kind === 'symbol') return qualify(head.file, [head.symbol, ...parts.slice(1, 2)]);
    if (head?.kind === 'module') return parts.length > 1 ? qualify(head.file, parts.slice(1, 3)) : null;
    return null;
  };

  const qualify = (file: string, symbolParts: string[]): string | null =>
    symbolParts.length === 0 ? null : qualifyId(file, symbolParts.join('.'));

  return {
    resolveCall(callee, classContext) {
      const parts = callee.replace(/\s+/g, '').split('.');
      if (!/^[A-Za-z_]/.test(parts[0])) return null;
      if ((parts[0] === 'self' || parts[0] === 'cls') && classContext && parts.length === 2) {
        return classMembers.get(classContext)?.has(parts[1]) ? qualifyId(relFile, `${classContext}.${parts[1]}`) : null;
      }
      const imported = resolveDotted(parts);
      if (imported) return imported;
      if (bindings.has(parts[0]) || topLevelSymbols.has(parts[0]) === false) return null;
      return qualifyId(relFile, parts.length > 1 ? `${parts[0]}.${parts[1]}` : parts[0]);
    },
    resolveType(expr) {
      const parts = expr.replace(/\s+/g, '').split('.');
      if (!/^[A-Za-z_]/.test(parts[0])) return null;
      const head = bindings.get(parts[0]);
      if (head?.kind === 'symbol' && parts.length === 1) return qualifyId(head.file, head.symbol);
      if (head?.kind === 'module' && parts.length === 2) return qualifyId(head.file, parts[1]);
      if (!head && topLevelSymbols.has(parts[0]) && parts.length === 1) return qualifyId(relFile, parts[0]);
      return null;
    },
  };
}
