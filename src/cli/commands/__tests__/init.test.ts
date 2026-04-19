import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  detectStack,
  detectTestFramework,
  renderProjectContext,
  runInit,
} from '../init.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ctk-init-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('detectStack', () => {
  it('detects node from package.json', () => {
    writeFileSync(join(tmp, 'package.json'), '{"name":"x"}');
    const r = detectStack(tmp);
    expect(r.stack).toContain('node');
    expect(r.manifests).toContain('package.json');
  });

  it('detects go from go.mod', () => {
    writeFileSync(join(tmp, 'go.mod'), 'module x\n');
    expect(detectStack(tmp).stack).toContain('go');
  });

  it('detects rust from Cargo.toml', () => {
    writeFileSync(join(tmp, 'Cargo.toml'), '[package]\nname="x"\n');
    expect(detectStack(tmp).stack).toContain('rust');
  });

  it('detects python from pyproject.toml', () => {
    writeFileSync(join(tmp, 'pyproject.toml'), '[tool.poetry]\n');
    expect(detectStack(tmp).stack).toContain('python');
  });

  it('returns empty stack when no manifest', () => {
    const r = detectStack(tmp);
    expect(r.stack).toEqual([]);
    expect(r.manifests).toEqual([]);
  });

  it('detects multiple stacks', () => {
    writeFileSync(join(tmp, 'package.json'), '{}');
    writeFileSync(join(tmp, 'go.mod'), 'module x');
    const r = detectStack(tmp);
    expect(r.stack).toEqual(expect.arrayContaining(['node', 'go']));
  });
});

describe('detectTestFramework', () => {
  it('detects vitest from package.json devDependencies', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' },
    }));
    expect(detectTestFramework(tmp)).toBe('vitest');
  });

  it('detects jest from package.json', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      devDependencies: { jest: '^29.0.0' },
    }));
    expect(detectTestFramework(tmp)).toBe('jest');
  });

  it('detects go test from go.mod', () => {
    writeFileSync(join(tmp, 'go.mod'), 'module x');
    expect(detectTestFramework(tmp)).toBe('go test');
  });

  it('detects pytest from pyproject.toml', () => {
    writeFileSync(join(tmp, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    expect(detectTestFramework(tmp)).toBe('pytest');
  });

  it('detects cargo test from Cargo.toml', () => {
    writeFileSync(join(tmp, 'Cargo.toml'), '[package]\nname="x"');
    expect(detectTestFramework(tmp)).toBe('cargo test');
  });

  it('returns null when no framework detected', () => {
    expect(detectTestFramework(tmp)).toBeNull();
  });
});

describe('renderProjectContext', () => {
  it('renders markdown with all fields', () => {
    const md = renderProjectContext({
      projectPath: '/x/y',
      stack: ['node'],
      manifests: ['package.json'],
      testFramework: 'vitest',
      tddEnabled: true,
      conventions: ['CLAUDE.md'],
      timestamp: '2026-04-18T00:00:00Z',
    });
    expect(md).toContain('/x/y');
    expect(md).toContain('node');
    expect(md).toContain('vitest');
    expect(md).toContain('Strict TDD: enabled');
    expect(md).toContain('CLAUDE.md');
  });

  it('marks TDD disabled when no test framework', () => {
    const md = renderProjectContext({
      projectPath: '/x',
      stack: [],
      manifests: [],
      testFramework: null,
      tddEnabled: false,
      conventions: [],
      timestamp: '2026-04-18T00:00:00Z',
    });
    expect(md).toContain('Strict TDD: disabled');
  });
});

describe('runInit', () => {
  it('creates .ctk/ with project-context.md and init.marker', () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' },
    }));
    const r = runInit(tmp);
    expect(existsSync(join(tmp, '.ctk/project-context.md'))).toBe(true);
    expect(existsSync(join(tmp, '.ctk/init.marker'))).toBe(true);
    expect(r.tddEnabled).toBe(true);
    expect(r.testFramework).toBe('vitest');
    const md = readFileSync(join(tmp, '.ctk/project-context.md'), 'utf-8');
    expect(md).toContain('vitest');
  });

  it('detects conventions files', () => {
    writeFileSync(join(tmp, 'CLAUDE.md'), '# x');
    writeFileSync(join(tmp, 'AGENTS.md'), '# y');
    const r = runInit(tmp);
    expect(r.conventions).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md']));
  });

  it('is idempotent (safe to re-run)', () => {
    writeFileSync(join(tmp, 'package.json'), '{}');
    runInit(tmp);
    runInit(tmp);
    expect(existsSync(join(tmp, '.ctk/init.marker'))).toBe(true);
  });

  it('does not overwrite existing .ctk/ files from user', () => {
    mkdirSync(join(tmp, '.ctk'));
    writeFileSync(join(tmp, '.ctk/custom.md'), 'user file');
    runInit(tmp);
    expect(readFileSync(join(tmp, '.ctk/custom.md'), 'utf-8')).toBe('user file');
  });
});
