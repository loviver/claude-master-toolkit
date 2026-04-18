import { output, outputError } from '../../shared/output.js';
import { openDb } from '../../shared/indexer/db-raw.js';
import { briefCreate, briefRead, briefValidate, briefFreeze } from '../../shared/indexer/queries.js';

export function briefNewCommand(id: string, opts: { task?: string }): void {
  if (!opts.task) outputError('brief new: --task="..." required');
  const db = openDb();
  try {
    const b = briefCreate(db, process.cwd(), id, opts.task!);
    output({ id: b.id, status: b.status, task: b.task, file: `~/.claude/ctk/briefs/${id}.md` });
  } finally {
    db.close();
    process.exit(0);
  }
}

export function briefReadCommand(id: string): void {
  const db = openDb();
  try {
    const b = briefRead(db, id);
    if (!b) outputError(`brief read: '${id}' not found`);
    output(b!);
  } finally {
    db.close();
    process.exit(0);
  }
}

export function briefValidateCommand(id: string): void {
  const db = openDb();
  try {
    const v = briefValidate(db, id);
    output(v);
    db.close();
    process.exit(v.valid ? 0 : 1);
  } catch (e) {
    db.close();
    throw e;
  }
}

export function briefFreezeCommand(id: string): void {
  const db = openDb();
  try {
    const r = briefFreeze(db, id);
    output(r);
  } finally {
    db.close();
    process.exit(0);
  }
}
