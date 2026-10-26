import { homedir } from 'os';
import { basename, isAbsolute, resolve } from 'path';
import type { HookTool } from '../runtime/types.js';

/**
 * Files a shell command line writes to, as absolute paths. Codex edits files through Bash
 * (`printf x > a.txt`), so edit-oriented guards (skill hints, reindex) cannot rely on an
 * edit tool existing. Covers the redirections `>` `>>` `>|` `&>`, `tee`, `sed -i`, and recurses
 * into `bash -c '...'`. Deliberately conservative: anything it cannot resolve statically
 * (variables, command substitution, /dev/*) is skipped rather than guessed.
 */
export function shellWrites(command: string, cwd: string): string[] {
  const out: string[] = [];
  collect(command, cwd, out, 0);
  return [...new Set(out)];
}

interface Word {
  t: 'word';
  v: string;
  dynamic: boolean; // contains $var / $(..) / `..`: not statically resolvable
}
interface Op {
  t: 'op';
  v: string;
  fd?: string;
}
type Tok = Word | Op;

const CONTROL = new Set(['|', '||', '&&', ';', '&', '(', ')', '\n']);

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let buf = '';
  let hasBuf = false; // distinguishes an empty quoted word ('') from no word
  let dynamic = false;
  let bufQuoted = false;
  const heredocs: Array<{ delim: string; strip: boolean }> = [];

  const flush = () => {
    if (hasBuf) toks.push({ t: 'word', v: buf, dynamic });
    buf = '';
    hasBuf = false;
    dynamic = false;
    bufQuoted = false;
  };
  const pushOp = (v: string) => {
    let fd: string | undefined;
    if (!bufQuoted && /^\d+$/.test(buf) && (v.startsWith('>') || v.startsWith('<'))) {
      fd = buf;
      buf = '';
      hasBuf = false;
    }
    flush();
    toks.push({ t: 'op', v, fd });
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i]!;

    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end === -1 ? src.length : end;
      buf += src.slice(i + 1, stop);
      hasBuf = true;
      bufQuoted = true;
      i = stop + 1;
      continue;
    }
    if (c === '"') {
      i++;
      hasBuf = true;
      bufQuoted = true;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          buf += src[i + 1];
          i += 2;
          continue;
        }
        if (src[i] === '$' || src[i] === '`') dynamic = true;
        buf += src[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === '\\' && i + 1 < src.length) {
      buf += src[i + 1];
      hasBuf = true;
      i += 2;
      continue;
    }
    if (c === '$' || c === '`') {
      dynamic = true;
      buf += c;
      hasBuf = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flush();
      i++;
      continue;
    }
    if (c === '\n') {
      flush();
      toks.push({ t: 'op', v: '\n' });
      i++;
      // Heredoc bodies start on the next line and end at their delimiter.
      for (const h of heredocs.splice(0)) {
        while (i < src.length) {
          let eol = src.indexOf('\n', i);
          if (eol === -1) eol = src.length;
          let line = src.slice(i, eol);
          i = Math.min(eol + 1, src.length);
          if (h.strip) line = line.replace(/^\t+/, '');
          if (line.trim() === h.delim) break;
        }
      }
      continue;
    }
    if (c === '<') {
      if (src.startsWith('<<<', i)) {
        pushOp('<<<');
        i += 3;
        continue;
      }
      if (src.startsWith('<<', i)) {
        i += 2;
        const strip = src[i] === '-';
        if (strip) i++;
        while (src[i] === ' ' || src[i] === '\t') i++;
        let delim = '';
        while (i < src.length && !/[\s;|&()<>]/.test(src[i]!)) {
          if (src[i] !== "'" && src[i] !== '"' && src[i] !== '\\') delim += src[i];
          i++;
        }
        flush();
        heredocs.push({ delim, strip });
        toks.push({ t: 'op', v: '<<' });
        continue;
      }
      if (src[i + 1] === '(') {
        // process substitution: `<(cmd)` reads; treat its parens as separators
        pushOp('<(');
        i += 2;
        continue;
      }
      pushOp('<');
      i++;
      continue;
    }
    if (c === '>') {
      if (src.startsWith('>>', i)) {
        pushOp('>>');
        i += 2;
      } else if (src.startsWith('>|', i)) {
        pushOp('>|');
        i += 2;
      } else if (src.startsWith('>&', i)) {
        pushOp('>&');
        i += 2;
      } else if (src[i + 1] === '(') {
        pushOp('>(');
        i += 2;
      } else {
        pushOp('>');
        i++;
      }
      continue;
    }
    if (c === '&') {
      if (src.startsWith('&>>', i)) {
        pushOp('&>>');
        i += 3;
      } else if (src.startsWith('&>', i)) {
        pushOp('&>');
        i += 2;
      } else if (src.startsWith('&&', i)) {
        pushOp('&&');
        i += 2;
      } else {
        pushOp('&');
        i++;
      }
      continue;
    }
    if (c === '|') {
      if (src.startsWith('||', i)) {
        pushOp('||');
        i += 2;
      } else {
        pushOp('|');
        i++;
      }
      continue;
    }
    if (c === ';' || c === '(' || c === ')') {
      pushOp(c);
      i++;
      continue;
    }

    buf += c;
    hasBuf = true;
    i++;
  }
  flush();
  return toks;
}

const STDOUT_REDIRECTS = new Set(['>', '>>', '>|']);
const ALWAYS_REDIRECTS = new Set(['&>', '&>>']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', 'nice']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

function resolveTarget(p: string, cwd: string): string | null {
  if (!p || p.startsWith('/dev/')) return null;
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(cwd, p);
}

function collect(command: string, cwd: string, out: string[], depth: number): void {
  const toks = tokenize(command);
  let seg: Tok[] = [];
  const segments: Tok[][] = [];
  for (const t of toks) {
    if (t.t === 'op' && CONTROL.has(t.v)) {
      segments.push(seg);
      seg = [];
    } else seg.push(t);
  }
  segments.push(seg);

  const add = (w: Word) => {
    if (w.dynamic) return;
    const r = resolveTarget(w.v, cwd);
    if (r) out.push(r);
  };

  for (const s of segments) {
    const words: Word[] = [];
    for (let i = 0; i < s.length; i++) {
      const t = s[i]!;
      if (t.t === 'word') {
        words.push(t);
        continue;
      }
      const target = s[i + 1];
      const isRedirect =
        ALWAYS_REDIRECTS.has(t.v) || (STDOUT_REDIRECTS.has(t.v) && (t.fd === undefined || t.fd === '1'));
      if (target?.t === 'word') {
        if (isRedirect) add(target);
        i++; // a redirect operand is never a command word
      }
    }

    let k = 0;
    while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k]!.v)) k++;
    while (k < words.length && WRAPPERS.has(basename(words[k]!.v))) {
      k++;
      while (k < words.length && (words[k]!.v.startsWith('-') || /^[A-Za-z_]\w*=/.test(words[k]!.v))) k++;
    }
    const cmd = words[k];
    if (!cmd) continue;
    const name = basename(cmd.v);
    const args = words.slice(k + 1);

    if (name === 'tee') {
      for (const a of args) if (!a.v.startsWith('-')) add(a);
    } else if (name === 'sed') {
      sedTargets(args, add);
    } else if (SHELLS.has(name) && depth < 3) {
      const ci = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a.v));
      const script = ci >= 0 ? args[ci + 1] : undefined;
      if (script && !script.dynamic) collect(script.v, cwd, out, depth + 1);
    }
  }
}

function sedTargets(args: Word[], add: (w: Word) => void): void {
  const inPlace = args.some((a) => /^--in-place(=.*)?$/.test(a.v) || /^-[A-Za-z]*i/.test(a.v));
  if (!inPlace) return;

  const positional: Word[] = [];
  let scriptViaFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (/^(-e|-f|--expression|--file)$/.test(a.v)) {
      scriptViaFlag = true;
      i++; // the script/file operand
    } else if (/^--(expression|file)=/.test(a.v)) {
      scriptViaFlag = true;
    } else if (a.v === '-i' && args[i + 1]?.v === '') {
      i++; // BSD form: -i '' (empty backup suffix)
    } else if (a.v.length > 1 && a.v.startsWith('-')) {
      continue;
    } else positional.push(a);
  }
  const files = scriptViaFlag ? positional : positional.slice(1); // first positional is the script
  for (const f of files) add(f);
}

/** Files a tool call writes: edit/write tools declare them, shell commands are analysed. */
export function writtenFiles(tool: HookTool | undefined, cwd: string): string[] {
  if (!tool) return [];
  if (tool.canonical === 'edit' || tool.canonical === 'write') return tool.filePaths ?? [];
  if (tool.canonical === 'shell' && tool.command) return shellWrites(tool.command, cwd);
  return [];
}
