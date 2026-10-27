import { homedir } from 'os';
import { basename, dirname, join } from 'path';
import {
  listProjectDirs,
  listSessionFiles,
  parseJsonlFile,
  extractSessionMeta,
  extractEnrichedTokenEvents,
  extractTurnDurations,
  extractHookAttachments,
  extractFileHistorySnapshots,
  extractUserContent,
} from '../../../shared/jsonl-parser/index.js';
import { decodeProjectDir } from '../extractors/project-dir.js';
import type { SessionSource } from './types.js';

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/** Claude Code: `~/.claude/projects/<encoded-cwd>/<session>.jsonl`. */
export const claudeSessionSource: SessionSource = {
  agent: 'claude-code',

  discover: () => listProjectDirs().flatMap((dir) => listSessionFiles(dir)),

  watchGlobs: () => [join(CLAUDE_PROJECTS_DIR, '**', '*.jsonl')],

  // Matches what the watcher glob delivers, including nested subagent transcripts.
  owns: (filePath) => filePath.endsWith('.jsonl'),

  async read(filePath) {
    const events = await parseJsonlFile(filePath);
    const meta = extractSessionMeta(events);
    return {
      meta,
      projectPath: meta.cwd || decodeProjectDir(basename(dirname(filePath))),
      tokenEvents: extractEnrichedTokenEvents(events),
      turnDurations: extractTurnDurations(events),
      hooks: extractHookAttachments(events),
      snapshots: extractFileHistorySnapshots(events),
      userContent: extractUserContent(events),
    };
  },
};
