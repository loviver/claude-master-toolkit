import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { output, outputError, readMainModel } from '../../shared/output.js';
import type { ModelPreference } from '../../shared/types.js';

const MODEL_PREF_FILE = join(homedir(), '.claude', 'state', 'claude-master-toolkit', 'model-preference');

function readPreference(): ModelPreference {
  try {
    if (existsSync(MODEL_PREF_FILE)) {
      return readFileSync(MODEL_PREF_FILE, 'utf-8').trim() as ModelPreference;
    }
  } catch {
    // Fall through
  }
  return 'inherit';
}

export function modelCommand(phase: string): void {
  const pref = readPreference();

  // pinned:<model> — absolute override
  if (pref.startsWith('pinned:')) {
    output(pref.slice(7));
    return;
  }

  const current = readMainModel();

  switch (pref) {
    case 'inherit':
      output(current);
      break;

    case 'auto':
    case 'smart':
      // Smart routing: only force a model when the phase has a clear reason.
      // All other phases INHERIT the main model — sub-agents using the ctk mini-DSL
      // (ctk_understand, ctk_find, etc.) stay coherent with the main conversation.
      switch (phase) {
        case 'sdd-propose':
        case 'sdd-design':
        case 'orchestrator':
          // Architectural reasoning — force opus
          output('opus');
          break;
        case 'sdd-archive':
          // Mechanical close-out — force haiku
          output('haiku');
          break;
        default:
          // sdd-explore, sdd-spec, sdd-tasks, sdd-apply, sdd-verify,
          // explore, implement, review, general → inherit
          output(current);
      }
      break;

    case 'opus':
    case 'sonnet':
    case 'haiku':
      output(pref);
      break;

    default:
      output(current);
  }
}

const VALID_PREFS = ['inherit', 'auto', 'smart', 'opus', 'sonnet', 'haiku'];

export function modelPrefCommand(action?: string, value?: string): void {
  mkdirSync(dirname(MODEL_PREF_FILE), { recursive: true });

  switch (action ?? 'get') {
    case 'get':
      output(existsSync(MODEL_PREF_FILE)
        ? readFileSync(MODEL_PREF_FILE, 'utf-8').trim()
        : 'inherit (default)');
      break;

    case 'set': {
      if (!value) {
        outputError('model-pref set: value required — inherit | auto | opus | sonnet | haiku | pinned:<model>');
      }
      if (!VALID_PREFS.includes(value!) && !value!.startsWith('pinned:')) {
        outputError(`model-pref: invalid value '${value}'. Valid: inherit | auto | smart | opus | sonnet | haiku | pinned:<model>`);
      }
      writeFileSync(MODEL_PREF_FILE, value!);
      output(`Model preference set: ${value}`);
      break;
    }

    case 'clear':
      if (existsSync(MODEL_PREF_FILE)) unlinkSync(MODEL_PREF_FILE);
      output('Model preference cleared (→ inherit)');
      break;

    default:
      outputError(`model-pref: unknown action '${action}'. Usage: ctk model-pref [get | set <value> | clear]`);
  }
}
