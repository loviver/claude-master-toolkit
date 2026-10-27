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
  riskChanges,
  sourceLanguage,
  MAX_LIMIT,
  type CodeGraph,
} from '../../shared/indexer/code-graph.js';
import { assessRisk } from '../../shared/risk/index.js';
import type {
  CodeGraphDTO,
  CodeGraphLevel,
  CodeGraphRevisionDTO,
  CodeGraphRiskDTO,
  CodeGraphSourceDTO,
} from '../../shared/api-types.js';
import { Lru } from '../lib/lru.js';

const LEVELS: readonly CodeGraphLevel[] = ['module', 'file', 'symbol'];
const MAX_DEPTH = 6;
const CACHE_ENTRIES = 24;
/** Bigger files are generated or vendored: not worth shipping to a code viewer. */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

interface ProjectQuery { project?: string }
interface GraphQuery extends ProjectQuery {
  level?: string;
  scope?: string;
  focus?: string;
  depth?: string;
  limit?: string;
}
interface RiskQuery extends ProjectQuery { level?: string; base?: string; worktree?: string }
interface SourceQuery extends ProjectQuery { file?: string }

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

export async function codeGraphRoutes(app: FastifyInstance): Promise<void> {
  // Graphs are pure over the index, so a revision-keyed cache can never serve stale data.
  const cache = new Lru<string, CodeGraph>(CACHE_ENTRIES);

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
    if (level === null) return reply.status(400).send({ error: `level must be one of ${LEVELS.join(', ')}` });
    if (depth === null) return reply.status(400).send({ error: `depth must be an integer in [1, ${MAX_DEPTH}]` });
    if (limit === null) return reply.status(400).send({ error: `limit must be an integer in [1, ${MAX_LIMIT}]` });
    if (!requireProject(reply, project)) return reply;

    const db = getSqlite();
    const revision = graphRevision(db, project);
    const key = JSON.stringify([project, revision, level, scope, focus, depth, limit]);
    let graph = cache.get(key);
    if (!graph) {
      graph = buildCodeGraph(db, project, { level, scope, focus, depth, limit });
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
    // Only files the indexer walked are readable: the index is the allow-list, not the query string.
    if (!isIndexedFile(db, project, file)) return reply.status(404).send({ error: `file not indexed: ${file}` });

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

  app.get<{ Querystring: RiskQuery }>('/code-graph/risk', async (req, reply) => {
    const { project, base } = req.query;
    const level = parseLevel(req.query.level);
    const worktree = req.query.worktree === '1' || req.query.worktree === 'true';
    if (level === null) return reply.status(400).send({ error: `level must be one of ${LEVELS.join(', ')}` });
    if (!requireProject(reply, project)) return reply;

    let assessment: ReturnType<typeof assessRisk>;
    try {
      assessment = assessRisk({ cwd: project, base: base || undefined, worktree });
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
      ...riskChanges(assessment.touched, assessment.ranges),
    };
    return reply.send(body);
  });
}
