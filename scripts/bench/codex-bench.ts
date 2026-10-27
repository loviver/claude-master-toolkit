#!/usr/bin/env tsx
/**
 * ctk vs direct (rg/sed) benchmark driven through `codex exec`.
 *
 *   npx tsx scripts/bench/codex-bench.ts [--tasks scripts/bench/tasks.json] [--reps 3] [--only id1,id2] [--model m]
 *
 * Every (task × variant × rep) runs in a FRESH `codex exec` session with the same flags
 * (`--ignore-user-config`: no hooks, no SessionStart, no user MCP). The only difference is
 * the ctk MCP server, added through `-c` on the ctk variant. Metrics are read from Codex's
 * JSON stream + rollout log, and the answer is graded against the ground truth in tasks.json.
 *
 * Requires an up-to-date `npm run build:cli` (the MCP server and indexer run from dist/).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseCodexStream, parseRolloutMcp, verdict, median } from '../../src/shared/bench/codex.js';
import type { Expectation, McpCallTiming, Verdict } from '../../src/shared/bench/codex.js';

type Variant = 'direct' | 'ctk';
interface Task { id: string; kind: string; prompt: string; expect: Expectation }
interface Row {
  task: string; kind: string; variant: Variant; rep: number; verdict: Verdict;
  wallMs: number; inputTokens: number; cachedTokens: number; outputTokens: number; reasoningTokens: number;
  toolCalls: number; mcpCalls: number; mcpFailed: number; shellCalls: number;
  mcpServerMsMedian: number | null; mcpWallMsMedian: number | null; friction: string[];
}

const argv = process.argv.slice(2);
const arg = (name: string, dflt?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};

const toolkit = resolve(import.meta.dirname, '..', '..');
const spec = JSON.parse(readFileSync(resolve(arg('tasks', join(toolkit, 'scripts/bench/tasks.json'))!), 'utf-8'));
const repo = resolve(toolkit, spec.repo ?? '.');
const reps = Number(arg('reps', '3'));
const only = arg('only')?.split(',');
const tasks: Task[] = spec.tasks.filter((t: Task) => !only || only.includes(t.id));
const model = arg('model');

const mcpJs = join(toolkit, 'dist', 'mcp.js');
const cliJs = join(toolkit, 'dist', 'cli.js');
for (const f of [mcpJs, cliJs]) if (!existsSync(f)) throw new Error(`${f} missing — run: npm run build:cli`);
const newestSrc = Math.max(...['src/shared/indexer/queries.ts', 'src/mcp/tools.ts', 'src/shared/indexer/ts-indexer.ts']
  .map((f) => statSync(join(toolkit, f)).mtimeMs));
if (statSync(mcpJs).mtimeMs < newestSrc) throw new Error('dist/mcp.js is older than src — run: npm run build:cli');

// ── Preflight: the index must exist and come from the same build the MCP server runs.
const t0 = Date.now();
const idx = spawnSync('node', [cliJs, 'index', 'build', '--path', repo], { encoding: 'utf-8' });
console.log(`[preflight] index build exit=${idx.status} in ${Date.now() - t0}ms`);
if (idx.status !== 0) throw new Error(`index build failed:\n${idx.stderr}${idx.stdout}`);

const SUFFIX = ' Be concise. Do not modify any file.';
const VARIANT_HINT: Record<Variant, string> = {
  direct: ' Inspect the repo ONLY with shell tools such as rg and sed -n.',
  ctk: ' Prefer the ctk_* MCP tools (ctk_find, ctk_understand, ctk_callers, ctk_deps) over reading files.',
};

function findRollout(threadId: string): string | null {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  const walk = (d: string): string | null => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { const r = walk(p); if (r) return r; }
      else if (e.name.endsWith(`${threadId}.jsonl`)) return p;
    }
    return null;
  };
  return existsSync(root) ? walk(root) : null;
}

function runOne(task: Task, variant: Variant, rep: number): Row {
  const args = ['exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', '-C', repo];
  if (model) args.push('-m', model);
  if (variant === 'ctk') args.push('-c', 'mcp_servers.ctk.command="node"', '-c', `mcp_servers.ctk.args=[${JSON.stringify(mcpJs)}]`);
  args.push(task.prompt + VARIANT_HINT[variant] + SUFFIX);

  const start = Date.now();
  const res = spawnSync('codex', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  const wallMs = Date.now() - start;
  const run = parseCodexStream(res.stdout ?? '');

  let timings: McpCallTiming[] = [];
  const rollout = run.threadId ? findRollout(run.threadId) : null;
  if (rollout) timings = parseRolloutMcp(readFileSync(rollout, 'utf-8'));

  const friction = [...run.mcpFailures];
  if (res.status !== 0) friction.push(`codex exit=${res.status} ${(res.stderr ?? '').slice(0, 200)}`);

  return {
    task: task.id, kind: task.kind, variant, rep,
    verdict: verdict(run.finalMessage, task.expect),
    wallMs, inputTokens: run.usage.input, cachedTokens: run.usage.cached,
    outputTokens: run.usage.output, reasoningTokens: run.usage.reasoning,
    toolCalls: run.toolCalls, mcpCalls: run.mcpCalls, mcpFailed: run.mcpFailed, shellCalls: run.shellCalls,
    mcpServerMsMedian: median(timings.map((t) => t.serverMs)),
    mcpWallMsMedian: median(timings.map((t) => t.wallMs)),
    friction,
  };
}

// Randomised order per rep so neither variant systematically benefits from a warm cache.
const rows: Row[] = [];
for (let rep = 1; rep <= reps; rep++) {
  const plan = tasks.flatMap((t) => (['direct', 'ctk'] as Variant[]).map((v) => ({ t, v })))
    .sort(() => Math.random() - 0.5);
  for (const { t, v } of plan) {
    const row = runOne(t, v, rep);
    rows.push(row);
    console.log(`[rep ${rep}] ${t.id.padEnd(18)} ${v.padEnd(6)} ${row.verdict.padEnd(10)} ${row.wallMs}ms in=${row.inputTokens} calls=${row.toolCalls}${row.mcpFailed ? ` MCP-FAILED=${row.mcpFailed}` : ''}`);
  }
}

// ── Report
const num = (n: number | null, d = 0) => (n === null ? '—' : n.toFixed(d));
const lines: string[] = [`# ctk vs direct — codex exec (${new Date().toISOString()})`, '', `repo: ${repo}  reps: ${reps}  model: ${model ?? 'default'}`, '',
  '| task | variant | correct/N | wall ms (med) | input tok (med) | output tok (med) | tool calls (med) | MCP server ms (med) | MCP failed |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
for (const t of tasks) for (const v of ['direct', 'ctk'] as Variant[]) {
  const rs = rows.filter((r) => r.task === t.id && r.variant === v);
  lines.push(`| ${t.id} | ${v} | ${rs.filter((r) => r.verdict === 'correct').length}/${rs.length} | ${num(median(rs.map((r) => r.wallMs)))} | ${num(median(rs.map((r) => r.inputTokens)))} | ${num(median(rs.map((r) => r.outputTokens)))} | ${num(median(rs.map((r) => r.toolCalls)))} | ${num(median(rs.flatMap((r) => r.mcpServerMsMedian ?? [])), 1)} | ${rs.reduce((a, r) => a + r.mcpFailed, 0)} |`);
}
const fr = rows.flatMap((r) => r.friction.map((f) => `- ${r.task}/${r.variant}#${r.rep}: ${f}`));
lines.push('', '## Friction', ...(fr.length ? fr : ['(none)']));

const outDir = join(repo, '.ctk', 'bench');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(join(outDir, `codex-${stamp}.md`), lines.join('\n') + '\n');
writeFileSync(join(outDir, `codex-${stamp}.json`), JSON.stringify(rows, null, 2));
console.log('\n' + lines.join('\n') + `\n\nsaved → ${outDir}/codex-${stamp}.{md,json}`);
