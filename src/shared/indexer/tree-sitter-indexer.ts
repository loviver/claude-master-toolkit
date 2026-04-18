import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';
import { createHash } from 'crypto';
import { relative } from 'path';
import type { LanguageIndexer, IndexedSymbol } from './indexer-interface.js';

type Lang = 'python' | 'go' | 'rust';

interface LangSpec {
  parser: Parser;
  symbolNodeTypes: Set<string>;
  callNodeTypes: Set<string>;
  getName: (node: Parser.SyntaxNode) => string | null;
  getKind: (node: Parser.SyntaxNode) => string;
  isExported: (node: Parser.SyntaxNode, name: string) => boolean;
  getSignature: (node: Parser.SyntaxNode, name: string) => string | null;
}

function mkParser(lang: any): Parser {
  const p = new Parser();
  p.setLanguage(lang);
  return p;
}

function namedChild(node: Parser.SyntaxNode, field: string): Parser.SyntaxNode | null {
  return node.childForFieldName(field);
}

const PYTHON_SPEC: LangSpec = {
  parser: mkParser(Python),
  symbolNodeTypes: new Set(['function_definition', 'class_definition']),
  callNodeTypes: new Set(['call']),
  getName: (n) => namedChild(n, 'name')?.text ?? null,
  getKind: (n) => (n.type === 'class_definition' ? 'class' : 'function'),
  isExported: (_n, name) => !name.startsWith('_'),
  getSignature: (n, name) => {
    if (n.type === 'function_definition') {
      const params = namedChild(n, 'parameters')?.text ?? '()';
      return `${name}${params}`;
    }
    return `class ${name}`;
  },
};

const GO_SPEC: LangSpec = {
  parser: mkParser(Go),
  symbolNodeTypes: new Set([
    'function_declaration',
    'method_declaration',
    'type_declaration',
  ]),
  callNodeTypes: new Set(['call_expression']),
  getName: (n) => {
    if (n.type === 'type_declaration') {
      const spec = n.namedChildren.find((c) => c.type === 'type_spec');
      return spec ? namedChild(spec, 'name')?.text ?? null : null;
    }
    return namedChild(n, 'name')?.text ?? null;
  },
  getKind: (n) => {
    if (n.type === 'method_declaration') return 'method';
    if (n.type === 'type_declaration') return 'type';
    return 'function';
  },
  isExported: (_n, name) => /^[A-Z]/.test(name),
  getSignature: (n, name) => {
    const params = namedChild(n, 'parameters')?.text ?? '';
    return `${name}${params}`;
  },
};

const RUST_SPEC: LangSpec = {
  parser: mkParser(Rust),
  symbolNodeTypes: new Set([
    'function_item',
    'struct_item',
    'enum_item',
    'trait_item',
    'impl_item',
  ]),
  callNodeTypes: new Set(['call_expression']),
  getName: (n) => {
    if (n.type === 'impl_item') {
      const type = namedChild(n, 'type');
      return type?.text ?? null;
    }
    return namedChild(n, 'name')?.text ?? null;
  },
  getKind: (n) => {
    if (n.type === 'struct_item') return 'struct';
    if (n.type === 'enum_item') return 'enum';
    if (n.type === 'trait_item') return 'trait';
    if (n.type === 'impl_item') return 'impl';
    return 'function';
  },
  isExported: (n) => {
    const vis = n.namedChildren.find((c) => c.type === 'visibility_modifier');
    return !!vis && vis.text.startsWith('pub');
  },
  getSignature: (n, name) => {
    const params = namedChild(n, 'parameters')?.text ?? '';
    return `${name}${params}`;
  },
};

const SPECS: Record<Lang, LangSpec> = {
  python: PYTHON_SPEC,
  go: GO_SPEC,
  rust: RUST_SPEC,
};

function detectLang(file: string): Lang | null {
  if (file.endsWith('.py')) return 'python';
  if (file.endsWith('.go')) return 'go';
  if (file.endsWith('.rs')) return 'rust';
  return null;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashContent(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function extractDeps(node: Parser.SyntaxNode, callTypes: Set<string>): string[] {
  const deps = new Set<string>();
  const walk = (n: Parser.SyntaxNode) => {
    if (callTypes.has(n.type)) {
      const fn = namedChild(n, 'function') ?? n.firstNamedChild;
      if (fn) {
        const text = fn.text;
        const root = text.split('.')[0].split('(')[0].split('::')[0];
        if (root && /^[A-Za-z_]/.test(root)) deps.add(root);
      }
    }
    for (const c of n.namedChildren) walk(c);
  };
  walk(node);
  return Array.from(deps).slice(0, 30);
}

export class TreeSitterIndexer implements LanguageIndexer {
  canHandle(file: string): boolean {
    return detectLang(file) !== null;
  }

  extractFromFile(projectPath: string, absPath: string, content: string): IndexedSymbol[] {
    const lang = detectLang(absPath);
    if (!lang) return [];
    const spec = SPECS[lang];
    const tree = spec.parser.parse(content);

    const relFile = relative(projectPath, absPath);
    const out: IndexedSymbol[] = [];

    const pushSymbol = (node: Parser.SyntaxNode, name: string, kind: string, bareName?: string) => {
      const text = node.text;
      out.push({
        projectPath,
        file: relFile,
        symbol: name,
        kind,
        signature: spec.getSignature(node, bareName ?? name),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        exported: spec.isExported(node, bareName ?? name),
        deps: extractDeps(node, spec.callNodeTypes),
        tokensEstimate: estimateTokens(text),
        contentHash: hashContent(text),
      });
    };

    const walk = (node: Parser.SyntaxNode, classContext: string | null) => {
      if (spec.symbolNodeTypes.has(node.type)) {
        const name = spec.getName(node);
        if (name) {
          const kind = spec.getKind(node);
          pushSymbol(node, name, kind);

          // Python methods inside class
          if (lang === 'python' && node.type === 'class_definition') {
            const body = namedChild(node, 'body');
            if (body) {
              for (const child of body.namedChildren) {
                if (child.type === 'function_definition') {
                  const mName = namedChild(child, 'name')?.text;
                  if (mName) pushSymbol(child, `${name}.${mName}`, 'method', mName);
                }
              }
            }
            return;
          }

          // Rust impl block: walk body for methods
          if (lang === 'rust' && node.type === 'impl_item') {
            const body = namedChild(node, 'body');
            if (body) {
              for (const child of body.namedChildren) {
                if (child.type === 'function_item') {
                  const mName = namedChild(child, 'name')?.text;
                  if (mName) pushSymbol(child, `${name}.${mName}`, 'method', mName);
                }
              }
            }
            return;
          }
          return;
        }
      }
      for (const c of node.namedChildren) walk(c, classContext);
    };

    walk(tree.rootNode, null);
    return out;
  }
}
