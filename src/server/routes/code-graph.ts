import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFileSync, realpathSync, statSync } from 'fs';
import { resolve, sep } from 'path';
import { getSqlite } from '../../shared/db/db.js';
import { projectIndexed } from '../../shared/indexer/queries.js';
import {
  buildCodeGraph,
  fileOutline,
  graphRevision,
  indexedFiles,
  indexedProjects,
  isIndexedFile,
  projectRisk,
  projectStatus,
  riskChanges,
  sourceLanguage,
  MAX_LIMIT,
  type CodeGraph,
} from '../../shared/indexer/code-graph.js';
import { searchSymbols, symbolDetails, SEARCH_MAX } from '../../shared/indexer/code-nav.js';
import { loadSymbolGraph, type SymbolGraph } from '../../shared/indexer/symbol-graph.js';
import { assessRisk } from '../../shared/risk/index.js';
import { getChangedFiles, getFileDiff, getFileStatuses, resolveBaseBranch } from '../../shared/risk/diff.js';
import { fileChurn } from '../../shared/indexer/churn.js';
import { addedBlocks, attributeBlocks, loadAgentEdits } from '../../shared/sessions/line-provenance.js';
import type {
  CodeGraphDiffDTO,
  CodeGraphProvenanceDTO,
  CodeGraphDirection,
  CodeGraphDTO,
  CodeGraphLevel,
  CodeGraphRevisionDTO,
  CodeGraphRiskDTO,
  CodeGraphSourceDTO,
  CodeGraphSymbolDTO,
  CodeGraphSymbolHitDTO,
} from '../../shared/api-types.js';
import { DIFF_FOCUS } from '../../shared/api-types.js';
import { Lru } from '../lib/lru.js';

const LEVELS: readonly CodeGraphLevel[] = ['module', 'file', 'symbol'];
const DIRECTIONS: readonly CodeGraphDirection[] = ['callers', 'deps', 'both'];
const MAX_DEPTH = 6;
const CACHE_ENTRIES = 24;
const CHURN_TTL_MS = 5 * 60_000;
/** Bigger files are generated or vendored: not worth shipping to a code viewer. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

interface ProjectQuery { project?: string }
interface GraphQuery extends ProjectQuery {
  level?: string;
  scope?: string;
  focus?: string;
  depth?: string;
  direction?: string;
  limit?: string;
  /** With `focus=@diff`: count uncommitted edits too, like the risk query. */
  worktree?: string;
}
interface RiskQuery extends ProjectQuery { level?: string; base?: string; worktree?: string }
interface SourceQuery extends ProjectQuery { file?: string }
interface DiffQuery extends SourceQuery { base?: string; worktree?: string }
interface SymbolsQuery extends ProjectQuery { q?: string; limit?: string }
interface SymbolQuery extends ProjectQuery { id?: string }

/** `undefined` when absent, `null` when present but not an integer in [min, max]. */
function intParam(raw: string | undefined, min: number, max: number): number | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function parseLevel(raw: string | undefined): CodeGraphLevel | null {
  if (raw === undefined || raw === '') return 'module';
  return (LEVELS as readonly string[]).includes(raw) ? (raw as CodeGraphLevel) : null;
}

function parseDirection(raw: string | undefined): CodeGraphDirection | undefined | null {
  if (raw === undefined || raw === '') return undefined;
  return (DIRECTIONS as readonly string[]).includes(raw) ? (raw as CodeGraphDirection) : null;
}

/** True when `file` is in the diff vs the default base, uncommitted edits included. No git → false. */
function isChangedFile(project: string, file: string): boolean {
  try {
    return getChangedFiles({ cwd: project, worktree: true }).includes(file);
  } catch {
    return false;
  }
}

/** A base ref is a name, never an option git would parse. */
const BASE_RE = /^[\w.][\w./-]*$/;

/**
 * Only projects already in the index are served. This also keeps the risk endpoint
 * from running git in arbitrary directories named by the query string.
 */
function requireProject(reply: FastifyReply, project: string | undefined): project is string {
  if (!project) {
    void reply.status(400).send({ error: 'project is required' });
    return false;
  }
  if (!projectIndexed(getSqlite(), project)) {
    void reply.status(404).send({ error: `project not indexed: ${project} (run ctk index build there)` });
    return false;
  }
  return true;
}

/** Which agent turn wrote each block of `+` lines; an annotation, so it never fails the diff. */
function diffProvenance(project: string, file: string, hunks: CodeGraphDiffDTO['hunks']): CodeGraphProvenanceDTO[] {
  const blocks = addedBlocks(hunks);
  if (blocks.length === 0) return [];
  try {
    return attributeBlocks(blocks, loadAgentEdits(getSqlite(), project, file));
  } catch {
    return [];
  }
}

export async function codeGraphRoutes(app: FastifyInstance): Promise<void> {
  // Graphs are pure over the index, so a revision-keyed cache can never serve stale data.
  const cache = new Lru<string, CodeGraph>(CACHE_ENTRIES);
  // Find usages reads the whole def/ref graph: load it once per index revision, not per click.
  const symbolGraphs = new Lru<string, SymbolGraph>(4);
  // git log over the churn window is slow on big repos; history moves slower than the index.
  const churns = new Lru<string, { at: number; map: Map<string, number> }>(4);
  const churnOf = (project: string) => {
    const hit = churns.get(project);
    if (hit && Date.now() - hit.at < CHURN_TTL_MS) return hit;
    const fresh = { at: Date.now(), map: fileChurn(project) };
    churns.set(project, fresh);
    return fresh;
  };

  app.get('/code-graph/projects', async (_req, reply) => reply.send(indexedProjects(getSqlite())));

  app.get<{ Querystring: ProjectQuery }>('/code-graph/revision', async (req, reply) => {
    const { project } = req.query;
    if (!requireProject(reply, project)) return reply;
    const body: CodeGraphRevisionDTO = { project, revision: graphRevision(getSqlite(), project) };
    return reply.send(body);
  });

  app.get<{ Querystring: GraphQuery }>('/code-graph', async (req, reply) => {
    const { project, scope, focus } = req.query;
    const level = parseLevel(req.query.level);
    const depth = intParam(req.query.depth, 1, MAX_DEPTH);
    const limit = intParam(req.query.limit, 1, MAX_LIMIT);
    const direction = parseDirection(req.query.direction);
    if (level === null) return reply.status(400).send({ error: `level must be one of ${LEVELS.join(', ')}` });
    if (depth === null) return reply.status(400).send({ error: `depth must be an integer in [1, ${MAX_DEPTH}]` });
    if (limit === null) return reply.status(400).send({ error: `limit must be an integer in [1, ${MAX_LIMIT}]` });
    if (direction === null) return reply.status(400).send({ error: `direction must be one of ${DIRECTIONS.join(', ')}` });
    if (!requireProject(reply, project)) return reply;

    let focusIds: string[] | undefined;
    if (focus === DIFF_FOCUS) {
      const worktree = req.query.worktree === '1' || req.query.worktree === 'true';
      try {
        focusIds = projectRisk(level, assessRisk({ cwd: project, worktree }).touched).touched;
      } catch (err) {
        return reply.status(422).send({ error: `diff impact unavailable: ${(err as Error).message}` });
      }
    }

    const db = getSqlite();
    const revision = graphRevision(db, project);
    const churn = churnOf(project);
    const key = JSON.stringify([project, revision, churn.at, level, scope, focus, focusIds, depth, direction, limit]);
    let graph = cache.get(key);
    if (!graph) {
      graph = buildCodeGraph(db, project, { level, scope, focus, focusIds, depth, direction, limit, churn: churn.map });
      cache.set(key, graph);
    }
    const body: CodeGraphDTO = { project, revision, ...graph };
    return reply.send(body);
  });

  app.get<{ Querystring: ProjectQuery }>('/code-graph/files', async (req, reply) => {
    const { project } = req.query;
    if (!requireProject(reply, project)) return reply;
    return reply.send(indexedFiles(getSqlite(), project));
  });

  app.get<{ Querystring: SourceQuery }>('/code-graph/source', async (req, reply) => {
    const { project, file } = req.query;
    if (!file) return reply.status(400).send({ error: 'file is required' });
    if (!requireProject(reply, project)) return reply;
    const db = getSqlite();
    // Only files the indexer walked or the diff touches are readable: the allow-list, not the query string.
    // A reviewer opens changed files the index may not cover yet (new tests, a stale index).
    if (!isIndexedFile(db, project, file) && !isChangedFile(project, file)) {
      return reply.status(404).send({ error: `file not indexed: ${file}` });
    }

    let content: string;
    try {
      const root = realpathSync(project);
      const abs = realpathSync(resolve(root, file));
      // A symlink inside the repo must not lead the viewer outside it.
      if (!abs.startsWith(root + sep)) return reply.status(403).send({ error: 'file resolves outside the project' });
      if (statSync(abs).size > MAX_SOURCE_BYTES) {
        return reply.status(413).send({ error: `file larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB` });
      }
      content = readFileSync(abs, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply.status(404).send({ error: `file no longer on disk: ${file}` });
      }
      throw err;
    }
    const body: CodeGraphSourceDTO = { file, language: sourceLanguage(file), content, outline: fileOutline(db, project, file) };
    return reply.send(body);
  });

  app.get<{ Querystring: DiffQuery }>('/code-graph/diff', async (req, reply) => {
    const { project, file } = req.query;
    const worktree = req.query.worktree === '1' || req.query.worktree === 'true';
    if (!file) return reply.status(400).send({ error: 'file is required' });
    if (req.query.base && !BASE_RE.test(req.query.base)) return reply.status(400).send({ error: 'base must be a ref name' });
    if (!requireProject(reply, project)) return reply;

    let body: CodeGraphDiffDTO;
    try {
      const base = req.query.base || resolveBaseBranch(project);
      // The diff's own file list is the allow-list: no traversal, no reading unchanged files.
      if (!getChangedFiles({ cwd: project, base, worktree }).includes(file)) {
        return reply.status(404).send({ error: `file not in the diff vs ${base}: ${file}` });
      }
      const diff = getFileDiff(file, { cwd: project, base, worktree });
      body = { file, base, worktree, language: sourceLanguage(file), ...diff, provenance: diffProvenance(project, file, diff.hunks) };
    } catch (err) {
      // No git checkout or unknown base: nothing to review, not a server fault.
      return reply.status(422).send({ error: `diff unavailable: ${(err as Error).message}` });
    }
    return reply.send(body);
  });

  app.get<{ Querystring: SymbolsQuery }>('/code-graph/symbols', async (req, reply) => {
    const { project, q } = req.query;
    const limit = intParam(req.query.limit, 1, SEARCH_MAX);
    if (q === undefined) return reply.status(400).send({ error: 'q is required' });
    if (limit === null) return reply.status(400).send({ error: `limit must be an integer in [1, ${SEARCH_MAX}]` });
    if (!requireProject(reply, project)) return reply;
    const body: CodeGraphSymbolHitDTO[] = searchSymbols(getSqlite(), project, q, limit);
    return reply.send(body);
  });

  app.get<{ Querystring: SymbolQuery }>('/code-graph/symbol', async (req, reply) => {
    const { project, id } = req.query;
    if (!id) return reply.status(400).send({ error: 'id is required' });
    if (!requireProject(reply, project)) return reply;
    const db = getSqlite();
    const key = JSON.stringify([project, graphRevision(db, project)]);
    let graph = symbolGraphs.get(key);
    if (!graph) {
      graph = loadSymbolGraph(db, project);
      symbolGraphs.set(key, graph);
    }
    const body: CodeGraphSymbolDTO | null = symbolDetails(db, project, id, graph);
    if (!body) return reply.status(404).send({ error: `symbol not indexed: ${id}` });
    return reply.send(body);
  });

  app.get<{ Querystring: RiskQuery }>('/code-graph/risk', async (req, reply) => {
    const { project, base } = req.query;
    const level = parseLevel(req.query.level);
    const worktree = req.query.worktree === '1' || req.query.worktree === 'true';
    if (level === null) return reply.status(400).send({ error: `level must be one of ${LEVELS.join(', ')}` });
    if (!requireProject(reply, project)) return reply;

    let assessment: ReturnType<typeof assessRisk>;
    let statuses: ReturnType<typeof getFileStatuses>;
    try {
      assessment = assessRisk({ cwd: project, base: base || undefined, worktree });
      statuses = getFileStatuses({ cwd: project, base: assessment.base, worktree });
    } catch (err) {
      // No git checkout, unknown base, detached state: an overlay that cannot be computed, not a server fault.
      return reply.status(422).send({ error: `risk unavailable: ${(err as Error).message}` });
    }
    const body: CodeGraphRiskDTO = {
      base: assessment.base,
      worktree,
      tier: assessment.score.tier,
      score: assessment.score.score,
      ...projectRisk(level, assessment.touched),
      status: projectStatus(level, assessment.touched, statuses),
      ...riskChanges(assessment.touched, assessment.ranges),
    };
    return reply.send(body);
  });
}
