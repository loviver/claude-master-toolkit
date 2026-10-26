import { homedir } from 'os';
import { join } from 'path';

/** Neutral root for ctk's own state. Not tied to any agent's config dir. */
export function ctkHome(): string {
  return process.env['CTK_HOME'] ?? join(homedir(), '.ctk');
}

export const ctkPaths = {
  db: () => process.env['CTK_DB_PATH'] ?? join(ctkHome(), 'ctk.sqlite'),
  modelPref: () => join(ctkHome(), 'model-preference'),
  modelsCache: () => process.env['CTK_MODEL_CACHE'] ?? join(ctkHome(), 'models'),
  /** Opt-in runtime packages (transformers.js) installed outside the toolkit's own tree. */
  ext: () => join(ctkHome(), 'ext'),
  briefsDir: () => join(ctkHome(), 'briefs'),
  logs: () => join(ctkHome(), 'logs'),
  /** One manifest per installed agent: exactly what `ctk install <agent>` wrote. */
  installs: () => join(ctkHome(), 'installs'),
  backups: () => join(ctkHome(), 'backups'),
  /** Keyed by agent AND session so two agents never share/overwrite state. */
  hookState: (agent: string, sessionId: string) =>
    join(ctkHome(), 'hooks-state', agent, sessionId),
};
