#!/usr/bin/env node

import { Command } from "commander";
import { setJsonMode } from "../shared/output.js";
import { sliceCommand } from "./commands/slice.js";
import { modelCommand, modelPrefCommand } from "./commands/model.js";
import { tokensCommand, estimateCommand } from "./commands/tokens.js";
import { costCommand, contextCommand } from "./commands/cost.js";
import { gitLogCommand, gitChangedCommand } from "./commands/git.js";
import { findCommand } from "./commands/find.js";
import { testSummaryCommand } from "./commands/test.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { installClaudeCommand } from "./commands/install.js";
import { uninstallClaudeCommand } from "./commands/uninstall.js";
import { initCommand } from "./commands/init.js";
import { skillRegistryCommand } from "./commands/skill-registry.js";
import { planCommand } from "./commands/plan.js";
import { orchestrateCommand } from "./commands/orchestrate.js";
import {
  indexBuildCommand,
  indexFindCommand,
  indexDepsCommand,
  indexCallersCommand,
} from "./commands/indexer.js";
import { understandCommand } from "./commands/understand.js";
import { schemaInspectCommand } from "./commands/schema-inspect.js";
import {
  briefNewCommand,
  briefReadCommand,
  briefValidateCommand,
  briefFreezeCommand,
} from "./commands/brief.js";
import { recordCommand, recallCommand } from "./commands/findings.js";
import {
  saveCommand as pandoricaSaveCommand,
  searchCommand as pandoricaSearchCommand,
  contextCommand as pandoricaContextCommand,
  recentCommand as pandoricaRecentCommand,
  getCommand as pandoricaGetCommand,
  deleteCommand as pandoricaDeleteCommand,
  summaryCommand as pandoricaSummaryCommand,
} from "./commands/pandorica.js";
import {
  memSaveCommand,
  memRecallCommand,
  memContextCommand,
  memTraceCommand,
  memGetCommand,
  memDeleteCommand,
  memSummaryCommand,
  memStatsCommand,
  memExportCommand,
  memImportCommand,
} from "./commands/mem.js";
import {
  benchTaskAddCommand,
  benchTaskListCommand,
  benchTaskRemoveCommand,
  benchIngestCommand,
  benchListCommand,
  benchShowCommand,
  benchCompareCommand,
  benchExportCommand,
  benchImportCommand,
} from "./commands/bench.js";
import {
  planCreateCommand,
  planListCommand,
  planGetCommand,
  planDeleteCommand,
  planExecCommand,
  planStatusCommand,
} from "./commands/plan-exec.js";

const VERSION = "0.1.14";
const VALID_PANDORICA_TYPES =
  "bugfix|decision|architecture|discovery|pattern|config|preference|session_summary";

const program = new Command()
  .name("ctk")
  .description(
    "Claude Master Toolkit — token-efficient CLI + metrics dashboard",
  )
  .version(VERSION)
  .option("--json", "Output in JSON format (AI-friendly)")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts["json"]) setJsonMode(true);
  });

const install = program
  .command("install")
  .description("Install integration stacks (claude, cursor, ...)");

install
  .command("claude")
  .description("Install Claude Code stack into ~/.claude (symlinks + settings)")
  .option("--skip-caveman", "Skip caveman plugin install")
  .action(installClaudeCommand);

const uninstall = program
  .command("uninstall")
  .description("Uninstall integration stacks");

uninstall
  .command("claude")
  .description("Uninstall Claude Code stack from ~/.claude (restore backup)")
  .option("--remove-caveman", "Also uninstall caveman plugin")
  .action(uninstallClaudeCommand);

program
  .command("init")
  .description(
    "Bootstrap .ctk/ — detect stack, test framework, TDD, conventions",
  )
  .action(initCommand);

program
  .command("skill-registry")
  .description("Scan skill sources, write .ctk/skill-registry.md index")
  .action(skillRegistryCommand);

program
  .command("plan <selection>")
  .description(
    "Resolve topological order for ctk components (comma-sep or 'all')",
  )
  .action(planCommand);

program
  .command("orchestrate <selection>")
  .description(
    "Run pipeline for ctk components (stub runners, Phase 0.3 wires real steps)",
  )
  .action(orchestrateCommand);

program
  .command("slice <file> <symbol>")
  .description("Extract a symbol block from a file (function/class/type)")
  .action(sliceCommand);

program
  .command("model <phase>")
  .description("Print model alias for an SDD phase (respects user preference)")
  .action(modelCommand);

program
  .command("model-pref [action] [value]")
  .description("Get/set/clear model selection preference")
  .action(modelPrefCommand);

program
  .command("tokens [file]")
  .description("Rough token estimate for a file or stdin (chars/4)")
  .action(tokensCommand);

program
  .command("estimate <file>")
  .description(
    "Faithful pre-flight token count via Anthropic API (fallback: rough)",
  )
  .action(estimateCommand);

program
  .command("cost")
  .description("Realized cost of current session (reads session JSONL)")
  .option("--quiet", "Print only the cost number")
  .action(costCommand);

program
  .command("context")
  .description("Show current Claude Code session context usage")
  .action(contextCommand);

program
  .command("git-log [count]")
  .description("Compact git log: last N commits (default 10)")
  .action(gitLogCommand);

program
  .command("git-changed")
  .description("List files changed vs main branch with line counts")
  .action(gitChangedCommand);

program
  .command("find <query> [path]")
  .description("Ranked search via ripgrep, top 20 results")
  .action(findCommand);

program
  .command("test-summary [cmd...]")
  .description("Run test command, show only pass/fail summary")
  .action(testSummaryCommand);

program
  .command("dashboard")
  .description("Open metrics dashboard in browser")
  .option("-p, --port <port>", "Server port", "3200")
  .option("--no-open", "Do not auto-open browser")
  .action(dashboardCommand);

const index = program
  .command("index")
  .description("Semantic symbol index (AST-based, token-efficient lookups)");

index
  .command("build")
  .description("Scan project, populate symbols table")
  .option("-p, --path <path>", "Project root (default: cwd)")
  .option("--force", "Wipe project index and rebuild from scratch")
  .action(indexBuildCommand);

index
  .command("find <symbol>")
  .description("Find symbol in index (JSON output)")
  .option(
    "--kind <kind>",
    "Filter by kind: class|function|method|type|interface|const",
  )
  .option("--exported", "Only exported symbols")
  .action(indexFindCommand);

index
  .command("deps <file>")
  .description("Show deps + exports of a file")
  .action(indexDepsCommand);

index
  .command("callers <symbol>")
  .description("Who calls this symbol")
  .action(indexCallersCommand);

program
  .command("understand <symbol>")
  .description(
    "Intent-based: combines find + slice + deps + callers in one JSON",
  )
  .action(understandCommand);

program
  .command("schema-inspect <jsonl>")
  .description("Extract and analyze schema structure from Claude Code JSONL session file")
  .option("--type <type>", "Filter to specific event type (user|assistant|...)")
  .option("--json", "Output as raw JSON to stdout")
  .option("--sample", "Show 1 real example per event type")
  .option("--depth <n>", "Schema inference depth", "3")
  .option("--output <dir>", "Output directory (default: .ctk/debug/schema-inspect/<slug>-<ts>/)")
  .option("--export-schemas", "Generate BigQuery-style declarative schemas per event type")
  .action(schemaInspectCommand);

const brief = program
  .command("brief")
  .description("Strict task contracts for sub-agents");

brief
  .command("new <id>")
  .description("Create a new brief markdown + DB row")
  .requiredOption("--task <text>", "One-line task description")
  .action(briefNewCommand);

brief
  .command("read <id>")
  .description("Read brief as JSON (parsed sections)")
  .action(briefReadCommand);

brief
  .command("validate <id>")
  .description("Validate brief schema (exit≠0 if invalid)")
  .action(briefValidateCommand);

brief
  .command("freeze <id>")
  .description(
    "Mark brief frozen (sub-agents blocked from further exploration)",
  )
  .action(briefFreezeCommand);

program
  .command("record")
  .description(
    "Record a finding to the shared pool (sub-agents share discoveries)",
  )
  .requiredOption("--type <type>", "bug|assumption|decision|deadend|pattern")
  .requiredOption("--finding <text>", "Short description")
  .option("--symbol <name>", "Related symbol")
  .option("--file <path>", "Related file")
  .option("--confidence <n>", "0-1 float (default 0.8)")
  .option("--role <name>", "agent role (explorer|implementer|reviewer)")
  .action(recordCommand);

program
  .command("recall")
  .description("Query findings pool (what other agents already discovered)")
  .option("--type <type>", "filter by type")
  .option("--symbol <name>", "filter by symbol")
  .option("--session <id>", "filter by session")
  .option("--since <duration>", "e.g. 1h, 30m, 2d")
  .action(recallCommand);

const bench = program
  .command("bench")
  .description("Benchmark A/B runs (ctk vs baseline) with export/import");

const benchTask = bench.command("task").description("Manage bench tasks");

benchTask
  .command("add <id>")
  .description("Register a new bench task")
  .requiredOption("--name <name>", "Human-readable name")
  .option("--description <text>", "Longer description")
  .option("--oracle <file>", "Path to oracle JSON for automated scoring")
  .action(benchTaskAddCommand);

benchTask
  .command("list")
  .description("List all registered bench tasks")
  .action(benchTaskListCommand);

benchTask
  .command("remove <id>")
  .description("Remove a bench task (cascades to runs and turns)")
  .action(benchTaskRemoveCommand);

bench
  .command("ingest <jsonl>")
  .description("Ingest a Claude Code JSONL session into the bench DB")
  .requiredOption("--task <id>", "Task id (must exist)")
  .requiredOption("--variant <v>", "ctk | baseline")
  .option("--model <m>", "Override model (default: autodetect from JSONL)")
  .option("--notes <text>", "Free-text notes for this run")
  .option("--success <0|1>", "Did the run succeed?")
  .action(benchIngestCommand);

bench
  .command("list")
  .description("List bench runs")
  .option("--task <id>", "Filter by task")
  .option("--variant <v>", "Filter by variant (ctk|baseline)")
  .action(benchListCommand);

bench
  .command("show <runId>")
  .description("Show a single run with turns (prefix match accepted)")
  .action(benchShowCommand);

bench
  .command("compare")
  .description("Compare variants on a task: avg/p50/p95 + delta")
  .requiredOption("--task <id>", "Task id")
  .action(benchCompareCommand);

bench
  .command("export")
  .description("Emit SQL dump of bench runs (redacts paths by default)")
  .option("--task <id>", "Filter by task")
  .option("--out <file>", "Write to file (default: stdout)")
  .option(
    "--include-paths",
    "Include source_jsonl paths and notes (may leak PII)",
  )
  .action(benchExportCommand);

bench
  .command("import <file>")
  .description("Import a bench SQL dump into the local DB")
  .action(benchImportCommand);

const pandorica = program
  .command("pandorica")
  .description("Persistent memory vault (Dr. Who-themed)");

pandorica
  .command("save")
  .description("Save a memory to the Pandorica")
  .requiredOption("--title <text>", "Short searchable title")
  .requiredOption("--type <type>", VALID_PANDORICA_TYPES)
  .option("--content <text>", "Inline content")
  .option("--file <path>", "Read content from file")
  .option("--stdin", "Read content from stdin")
  .option("--scope <scope>", "project|personal", "project")
  .option("--topic-key <key>", "Stable key for upsert (e.g. architecture/auth)")
  .option("--project-path <path>", "Override project path (default: cwd)")
  .option("--session-id <id>", "Attach to a session")
  .action(pandoricaSaveCommand);

pandorica
  .command("search <query>")
  .description("Search memories by keyword")
  .option("--limit <n>", "Max results (default 20)")
  .option("--type <type>", "Filter by type")
  .option("--scope <scope>", "Filter by scope")
  .option("--project-path <path>", "Filter by project path")
  .action(pandoricaSearchCommand);

pandorica
  .command("context")
  .description("Recent memories for current project/session")
  .option("--project-path <path>", "Override project path (default: cwd)")
  .option("--session-id <id>", "Filter by session")
  .option("--limit <n>", "Max results (default 10)")
  .action(pandoricaContextCommand);

pandorica
  .command("recent")
  .description("Last N memories by creation date")
  .option("--limit <n>", "Max results (default 10)")
  .option("--all", "All projects (default: current cwd only)")
  .action(pandoricaRecentCommand);

pandorica
  .command("get <id>")
  .description("Full untruncated memory by id")
  .action(pandoricaGetCommand);

pandorica
  .command("delete <id>")
  .description("Delete a memory by id")
  .action(pandoricaDeleteCommand);

pandorica
  .command("summary")
  .description("Persist a session summary (markdown)")
  .option("--content <text>", "Inline content")
  .option("--file <path>", "Read from file")
  .option("--stdin", "Read from stdin")
  .option("--session-id <id>", "Session id (used as topic key)")
  .option("--project-path <path>", "Override project path")
  .option("--title <text>", "Override title")
  .action(pandoricaSummaryCommand);

const mem = program
  .command("mem")
  .description(
    "Pandorica v2 memory vault — structured + FTS5 + cost correlation",
  );

mem
  .command("save")
  .description("Save a structured memory")
  .requiredOption("--title <text>", "Short searchable title")
  .option(
    "--type <type>",
    "decision|bugfix|architecture|pattern|preference|reference|note|session_summary",
    "note",
  )
  .option("--what <text>", "What happened (one sentence)")
  .option("--why <text>", "Motivation / root cause")
  .option("--where <text>", "Files or paths")
  .option("--learned <text>", "Gotchas or surprises")
  .option("--content <text>", "Fallback: body (if --what empty)")
  .option("--file <path>", "Read body from file")
  .option("--stdin", "Read body from stdin")
  .option("--scope <scope>", "project|personal", "project")
  .option("--topic-key <key>", "Stable key for upsert")
  .option("--project-path <path>", "Override project path (default: cwd)")
  .option("--session-id <id>", "Attach to a session")
  .action(memSaveCommand);

mem
  .command("recall <query>")
  .description("FTS5 search with BM25 ranking")
  .option("--limit <n>", "Max results (default 20)")
  .option("--type <type>", "Filter by type")
  .option("--scope <scope>", "Filter by scope")
  .option("--project-path <path>", "Filter by project path")
  .action(memRecallCommand);

mem
  .command("context")
  .description("Recent memories for project/session")
  .option("--project-path <path>", "Override project path (default: cwd)")
  .option("--session-id <id>", "Filter by session")
  .option("--limit <n>", "Max results (default 10)")
  .action(memContextCommand);

mem
  .command("trace")
  .description("Timeline of memories by creation date")
  .option("--project-path <path>")
  .option("--session-id <id>")
  .option("--limit <n>")
  .action(memTraceCommand);

mem
  .command("get <id>")
  .description("Full untruncated memory (bumps access_count)")
  .action(memGetCommand);

mem
  .command("delete <id>")
  .description("Delete a memory")
  .action(memDeleteCommand);

mem
  .command("summary")
  .description("Persist a session summary")
  .option("--content <text>")
  .option("--file <path>")
  .option("--stdin")
  .option("--session-id <id>")
  .option("--project-path <path>")
  .option("--title <text>")
  .action(memSummaryCommand);

mem
  .command("stats")
  .description("Memory counts, ROI, cost saved, top-accessed")
  .option("--project-path <path>", "Default: cwd")
  .option("--all", "All projects (ignores cwd)")
  .action(memStatsCommand);

mem
  .command("export")
  .description("Dump vault to JSON")
  .option("--project-path <path>")
  .option("--all", "Export all projects")
  .option("--out <path>", "Write to file (default: stdout)")
  .action(memExportCommand);

mem
  .command("import")
  .description("Load a previously-exported vault dump")
  .option("--file <path>")
  .option("--stdin")
  .action(memImportCommand);

const wf = program
  .command("wf")
  .description("Workflow plans — create, execute, track");

wf
  .command("create <name> <json-file>")
  .description("Create plan from JSON definition")
  .option("--project-path <path>", "Override project path")
  .action(planCreateCommand);

wf
  .command("list")
  .description("List all plans")
  .option("--project-path <path>", "Filter by project")
  .action(planListCommand);

wf
  .command("get <plan-id>")
  .description("View plan definition")
  .action(planGetCommand);

wf
  .command("delete <plan-id>")
  .description("Delete a plan")
  .action(planDeleteCommand);

wf
  .command("exec <plan-id>")
  .description("Execute a plan")
  .action(planExecCommand);

wf
  .command("status <execution-id>")
  .description("Get execution status and timeline")
  .action(planStatusCommand);

program.parse();
