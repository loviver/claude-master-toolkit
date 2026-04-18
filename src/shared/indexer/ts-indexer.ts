import { Project, SyntaxKind, type Node, type SourceFile } from 'ts-morph';
import { createHash } from 'crypto';
import { relative, resolve } from 'path';

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
    if (kind === SyntaxKind.ClassDeclaration || kind === SyntaxKind.InterfaceDeclaration) {
      const cls = node as any;
      return `${kind === SyntaxKind.ClassDeclaration ? 'class' : 'interface'} ${cls.getName?.() ?? ''}`;
    }
    if (kind === SyntaxKind.TypeAliasDeclaration) {
      return (node as any).getText?.().split('\n')[0] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

function extractDeps(node: Node): string[] {
  const deps = new Set<string>();
  node.forEachDescendant((child) => {
    if (child.getKind() === SyntaxKind.CallExpression) {
      const expr = (child as any).getExpression?.();
      if (expr) {
        const text = expr.getText();
        const root = text.split('.')[0].split('(')[0];
        if (root && /^[A-Za-z_]/.test(root)) deps.add(root);
      }
    }
  });
  return Array.from(deps).slice(0, 30);
}

function collectSymbols(
  sourceFile: SourceFile,
  projectPath: string,
  filePath: string,
): IndexedSymbol[] {
  const out: IndexedSymbol[] = [];
  const relFile = relative(projectPath, filePath);

  const pushSymbol = (node: Node, name: string, kind: string, exported: boolean) => {
    const text = node.getText();
    out.push({
      projectPath,
      file: relFile,
      symbol: name,
      kind,
      signature: extractSignature(node),
      startLine: node.getStartLineNumber(),
      endLine: node.getEndLineNumber(),
      exported,
      deps: extractDeps(node),
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
    skipFileDependencyResolution: true,
  });
}

export interface ProjectSourceFiles {
  absRoot: string;
  files: string[];
  extract: (absPath: string) => IndexedSymbol[];
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

  return { absRoot, files, extract };
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
