import { describe, it, expect } from 'vitest';
import { shellWrites } from '../shell-writes.js';

const CWD = '/proj';
const w = (cmd: string) => shellWrites(cmd, CWD);

describe('shellWrites: redirections', () => {
  it.each([
    ["printf 'hola' > a.txt", ['/proj/a.txt']],
    ['echo hi >> logs/out.ts', ['/proj/logs/out.ts']],
    ['echo hi>a.txt', ['/proj/a.txt']],
    ['echo hi 1> a.txt', ['/proj/a.txt']],
    ['echo hi >| a.txt', ['/proj/a.txt']],
    ['echo hi &> a.txt', ['/proj/a.txt']],
    ['cat x > "my file.ts"', ['/proj/my file.ts']],
    ["cat x > 'q.ts'", ['/proj/q.ts']],
    ['cat x > /abs/dir/z.go', ['/abs/dir/z.go']],
    ['echo a > one.ts && echo b > two.ts', ['/proj/one.ts', '/proj/two.ts']],
    ['cd sub && echo a > x.ts; echo b >> y.ts | cat', ['/proj/x.ts', '/proj/y.ts']],
  ])('%s', (cmd, expected) => {
    expect(w(cmd)).toEqual(expected);
  });

  it.each([
    'ls > /dev/null',
    'ls 2> err.log',
    'ls 2>/dev/null',
    'ls >&2',
    'ls 2>&1',
    'ls &>/dev/null',
    'echo "a > b"',
    "echo 'a > b.ts'",
    'echo hi > $OUT',
    'echo hi > "${DIR}/a.ts"',
    'diff <(ls) <(ls)',
    'cat < in.txt',
    'ls',
    '',
  ])('no write detected: %s', (cmd) => {
    expect(w(cmd)).toEqual([]);
  });

  it('heredoc body is not scanned, only the redirect after it', () => {
    const cmd = "cat <<'EOF' > src/a.ts\nconst x = 1 > 0;\necho > fake.ts\nEOF\n";
    expect(w(cmd)).toEqual(['/proj/src/a.ts']);
  });

  it('heredoc with <<- and an inner redirect after the terminator', () => {
    const cmd = 'cat <<-END\n\tbody > nope.ts\n\tEND\necho x > real.ts';
    expect(w(cmd)).toEqual(['/proj/real.ts']);
  });

  it('dedupes', () => {
    expect(w('echo a > x.ts; echo b >> x.ts')).toEqual(['/proj/x.ts']);
  });
});

describe('shellWrites: tee', () => {
  it.each([
    ['echo hi | tee a.txt', ['/proj/a.txt']],
    ['echo hi | tee -a a.txt b.ts', ['/proj/a.txt', '/proj/b.ts']],
    ['echo hi | tee --append out.ts', ['/proj/out.ts']],
    ['echo hi | sudo tee /etc/x.conf', ['/etc/x.conf']],
    ['echo hi | tee /dev/null', []],
    ['echo hi | tee', []],
  ])('%s', (cmd, expected) => {
    expect(w(cmd)).toEqual(expected);
  });
});

describe('shellWrites: sed -i', () => {
  it.each([
    ["sed -i 's/a/b/' f.ts", ['/proj/f.ts']],
    ["sed -i.bak 's/a/b/' f.ts g.ts", ['/proj/f.ts', '/proj/g.ts']],
    ["sed -i '' 's/a/b/' f.ts", ['/proj/f.ts']],
    ["sed --in-place 's/a/b/' f.ts", ['/proj/f.ts']],
    ["sed --in-place=.orig 's/a/b/' f.ts", ['/proj/f.ts']],
    ["sed -n -i 's/a/b/p' f.ts", ['/proj/f.ts']],
    ["sed -i -e 's/a/b/' -e 's/c/d/' f.ts", ['/proj/f.ts']],
    ["sed -i -E 's/(a)/\\1/' src/f.ts", ['/proj/src/f.ts']],
    ["find . -name '*.ts' | xargs sed -i 's/a/b/'", []],
  ])('%s', (cmd, expected) => {
    expect(w(cmd)).toEqual(expected);
  });

  it('sed without -i only reads', () => {
    expect(w("sed 's/a/b/' f.ts")).toEqual([]);
    expect(w("sed -n '1,5p' f.ts")).toEqual([]);
  });
});

describe('shellWrites: wrappers and robustness', () => {
  it('looks inside bash -c / sh -c strings', () => {
    expect(w(`bash -c "printf x > a.ts"`)).toEqual(['/proj/a.ts']);
    expect(w(`sh -lc 'echo x | tee b.ts'`)).toEqual(['/proj/b.ts']);
  });

  it('skips env assignments and sudo/env/time prefixes', () => {
    expect(w("FOO=1 sed -i 's/a/b/' f.ts")).toEqual(['/proj/f.ts']);
    expect(w("sudo sed -i 's/a/b/' /etc/h")).toEqual(['/etc/h']);
  });

  it('unterminated quote / garbage never throws', () => {
    expect(() => w('echo "unterminated > a.ts')).not.toThrow();
    expect(() => w('>>>>')).not.toThrow();
    expect(w('echo hi >')).toEqual([]);
  });

  it('commands that merely contain the words are not writes', () => {
    expect(w('grep -r "tee" .')).toEqual([]);
    expect(w('git log --grep="sed -i"')).toEqual([]);
  });
});
