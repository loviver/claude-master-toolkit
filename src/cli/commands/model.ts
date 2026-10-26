import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { output, outputError } from '../../shared/output.js';
import { readMainModel, resolveAgentId } from '../../shared/agents/resolve.js';
import { resolveModel } from '../../shared/models/router.js';
import type { ModelPreference } from '../../shared/types/index.js';

import { ctkPaths } from '../../shared/paths/ctk-home.js';

const modelPrefFile = (): string => ctkPaths.modelPref();

function readPreference(): ModelPreference {
  try {
    if (existsSync(modelPrefFile())) {
      return readFileSync(modelPrefFile(), 'utf-8').trim() as ModelPreference;
    }
  } catch {
    // Fall through
  }
  return 'inherit';
}

export function modelCommand(phase: string, opts: { agent?: string } = {}): void {
  let agent;
  try {
    agent = resolveAgentId(opts.agent);
  } catch (e) {
    outputError((e as Error).message);
    process.exit(1);
  }
  output(resolveModel({ agent, current: readMainModel(agent), pref: readPreference(), phase }));
}

const VALID_PREFS = ['inherit', 'auto', 'smart', 'opus', 'sonnet', 'haiku'];

export function modelPrefCommand(action?: string, value?: string): void {
  mkdirSync(dirname(modelPrefFile()), { recursive: true });

  switch (action ?? 'get') {
    case 'get':
      output(existsSync(modelPrefFile())
        ? readFileSync(modelPrefFile(), 'utf-8').trim()
        : 'inherit (default)');
      break;

    case 'set': {
      if (!value) {
        outputError('model-pref set: value required — inherit | auto | opus | sonnet | haiku | pinned:<model>');
      }
      if (!VALID_PREFS.includes(value!) && !value!.startsWith('pinned:')) {
        outputError(`model-pref: invalid value '${value}'. Valid: inherit | auto | smart | opus | sonnet | haiku | pinned:<model>`);
      }
      writeFileSync(modelPrefFile(), value!);
      output(`Model preference set: ${value}`);
      break;
    }

    case 'clear':
      if (existsSync(modelPrefFile())) unlinkSync(modelPrefFile());
      output('Model preference cleared (→ inherit)');
      break;

    default:
      outputError(`model-pref: unknown action '${action}'. Usage: ctk model-pref [get | set <value> | clear]`);
  }
}
