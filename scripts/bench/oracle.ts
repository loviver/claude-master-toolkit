#!/usr/bin/env tsx
/**
 * Verify bench ground truth against the code with the TypeScript type-checker.
 *
 *   npx tsx scripts/bench/oracle.ts [--tasks scripts/bench/tasks.json]
 *
 * Every task with an `oracle` spec (see src/shared/bench/oracle.ts) is recomputed and compared
 * with its `expect` (path entries only — free-text entries such as function names are graded by
 * the bench, not here). Exits 1 on any divergence so a stale task never grades a run. Tasks
 * without an oracle are listed as unverified. Run it before codex-bench.ts.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Project } from 'ts-morph';
import { computeOracle, checkExpectation, type OracleSpec } from '../../src/shared/bench/oracle.js';
import type { Expectation } from '../../src/shared/bench/codex.js';

interface Task { id: string; expect: Expectation; oracle?: OracleSpec }

const argv = process.argv.slice(2);
const i = argv.indexOf('--tasks');
const toolkit = resolve(import.meta.dirname, '..', '..');
const tasksPath = resolve(i >= 0 ? argv[i + 1]! : join(toolkit, 'scripts/bench/tasks.json'));
const spec = JSON.parse(readFileSync(tasksPath, 'utf-8')) as { repo?: string; tasks: Task[] };
const repo = resolve(toolkit, spec.repo ?? '.');

const project = new Project({ tsConfigFilePath: join(repo, 'tsconfig.json') });
const isPath = (s: string) => s.includes('/');

let failed = 0;
for (const task of spec.tasks) {
  if (!task.oracle) {
    console.log(`?  ${task.id}: no oracle — unverified`);
    continue;
  }
  const truth = computeOracle(project, repo, task.oracle);
  const check = checkExpectation(
    { all: task.expect.all.filter(isPath), none: (task.expect.none ?? []).filter(isPath) },
    truth,
  );
  if (check.ok) {
    console.log(`✓  ${task.id}`);
    continue;
  }
  failed++;
  console.log(`✗  ${task.id}\n   truth:   ${JSON.stringify(truth)}`);
  if (check.missing.length) console.log(`   missing: ${JSON.stringify(check.missing)}`);
  if (check.extra.length) console.log(`   extra:   ${JSON.stringify(check.extra)}`);
  if (check.decoysInTruth.length) console.log(`   decoys that are true: ${JSON.stringify(check.decoysInTruth)}`);
}

if (failed) {
  console.log(`\n${failed} task(s) diverge from the code — fix tasks.json before benchmarking.`);
  process.exit(1);
}
