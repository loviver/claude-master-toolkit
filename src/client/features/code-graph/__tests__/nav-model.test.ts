import { describe, expect, it } from 'vitest';
import type { CodeGraphOutlineDTO, CodeGraphSymbolDTO } from '../../../lib/types';
import {
  declarationCandidates,
  emptyHistory,
  goBack,
  goForward,
  HISTORY_MAX,
  innermostAt,
  isDoubleShift,
  nodeForCaret,
  outlineTree,
  pushHistory,
  resolveIdentifier,
  splitIdentifiers,
  symbolIcon,
  type NavLocation,
} from '../nav-model';

const at = (file: string, line: number): NavLocation => ({ file, range: [line, line] });

describe('navigation history', () => {
  it('goes back to where a navigation started, and forward again', () => {
    let h = pushHistory(emptyHistory, at('a.ts', 1));
    h = pushHistory(h, at('b.ts', 2));
    const back = goBack(h, at('c.ts', 3))!;
    expect(back.target).toEqual(at('b.ts', 2));
    const fwd = goForward(back.history, back.target)!;
    expect(fwd.target).toEqual(at('c.ts', 3));
    expect(fwd.history.back).toEqual([at('a.ts', 1), at('b.ts', 2)]);
  });

  it('a new navigation drops the forward stack', () => {
    const back = goBack(pushHistory(emptyHistory, at('a.ts', 1)), at('b.ts', 2))!;
    expect(back.history.forward).toHaveLength(1);
    expect(pushHistory(back.history, at('a.ts', 1)).forward).toEqual([]);
  });

  it('does not record the graph (no location) nor the same place twice in a row', () => {
    expect(pushHistory(emptyHistory, null).back).toEqual([]);
    const h = pushHistory(pushHistory(emptyHistory, at('a.ts', 1)), at('a.ts', 1));
    expect(h.back).toEqual([at('a.ts', 1)]);
  });

  it('is null when there is nowhere to go', () => {
    expect(goBack(emptyHistory, at('a.ts', 1))).toBeNull();
    expect(goForward(emptyHistory, at('a.ts', 1))).toBeNull();
  });

  it('forgets the oldest entries past the cap', () => {
    let h = emptyHistory;
    for (let i = 0; i < HISTORY_MAX + 5; i++) h = pushHistory(h, at('a.ts', i + 1));
    expect(h.back).toHaveLength(HISTORY_MAX);
    expect(h.back[0]).toEqual(at('a.ts', 6));
  });
});

const o = (symbol: string, startLine: number, endLine: number, kind = 'function'): CodeGraphOutlineDTO =>
  ({ id: `f.ts::${symbol}`, symbol, kind, startLine, endLine });

describe('outlineTree', () => {
  it('nests members inside the symbols that span them', () => {
    const tree = outlineTree([o('A', 1, 10, 'class'), o('A.m', 2, 4, 'method'), o('A.n', 5, 9, 'method'), o('b', 12, 14)]);
    expect(tree.map((n) => [n.item.symbol, n.children.map((c) => c.item.symbol)])).toEqual([
      ['A', ['A.m', 'A.n']],
      ['b', []],
    ]);
  });

  it('nests deeper levels', () => {
    const tree = outlineTree([o('A', 1, 10), o('A.m', 2, 8), o('A.m.x', 3, 3, 'const')]);
    expect(tree[0].children[0].children[0].item.symbol).toBe('A.m.x');
  });
});

describe('innermostAt', () => {
  it('picks the narrowest symbol around a line', () => {
    const outline = [o('A', 1, 10), o('A.m', 2, 4), o('b', 12, 14)];
    expect(innermostAt(outline, 3)?.symbol).toBe('A.m');
    expect(innermostAt(outline, 6)?.symbol).toBe('A');
    expect(innermostAt(outline, 11)).toBeUndefined();
  });
});

describe('splitIdentifiers', () => {
  it('cuts identifiers out of a plain token, keeping the text around them', () => {
    expect(splitIdentifiers(' foo_1 = $bar ')).toEqual([
      { text: ' ', ident: false },
      { text: 'foo_1', ident: true },
      { text: ' = ', ident: false },
      { text: '$bar', ident: true },
      { text: ' ', ident: false },
    ]);
  });

  it('does not treat numbers as identifiers', () => {
    expect(splitIdentifiers('42')).toEqual([{ text: '42', ident: false }]);
  });
});

const ref = (id: string, startLine = 1) => {
  const [file, symbol] = id.split('::');
  return { id, symbol, kind: 'function', file, startLine, endLine: startLine + 2 };
};

function details(over: Partial<CodeGraphSymbolDTO>): CodeGraphSymbolDTO {
  return {
    ...ref('src/a.ts::useA'), exported: true, signature: null,
    callers: [], referrers: [], callees: [], references: [], supertypes: [], subtypes: [], members: [],
    ...over,
  };
}

describe('resolveIdentifier', () => {
  it('prefers the callee called on the clicked line', () => {
    const candidates = declarationCandidates(details({
      callees: [{ ...ref('src/x.ts::run'), lines: [3] }, { ...ref('src/y.ts::run'), lines: [8] }],
    }), [], 'src/a.ts');
    expect(resolveIdentifier('run', 8, candidates).map((c) => c.id)).toEqual(['src/y.ts::run']);
  });

  it('matches a method by its member name, direct calls before overrides', () => {
    const candidates = declarationCandidates(details({
      callees: [
        { ...ref('src/c.ts::Circle.area'), lines: [12], dispatch: true },
        { ...ref('src/s.ts::Shape.area'), lines: [12] },
      ],
    }), [], 'src/a.ts');
    expect(resolveIdentifier('area', 12, candidates).map((c) => c.id)).toEqual(['src/s.ts::Shape.area']);
  });

  it('falls back to types, members and same-file symbols, returning every equally good match', () => {
    const candidates = declarationCandidates(
      details({ references: [ref('src/t.ts::Props')] }),
      [o('Props', 30, 35, 'interface')],
      'src/a.ts',
    );
    expect(resolveIdentifier('Props', 5, candidates).map((c) => c.id).sort()).toEqual(['f.ts::Props', 'src/t.ts::Props']);
  });

  it('finds nothing for an unknown name', () => {
    expect(resolveIdentifier('nope', 1, declarationCandidates(undefined, [o('a', 1, 2)], 'src/a.ts'))).toEqual([]);
  });
});

describe('isDoubleShift', () => {
  it('is true for a second Shift press soon after the first', () => {
    expect(isDoubleShift(1000, 1300)).toBe(true);
    expect(isDoubleShift(1000, 1600)).toBe(false);
    expect(isDoubleShift(null, 1000)).toBe(false);
  });
});

describe('symbolIcon', () => {
  it('maps index kinds to codicons, with a fallback', () => {
    expect(symbolIcon('class')).toBe('symbol-class');
    expect(symbolIcon('method')).toBe('symbol-method');
    expect(symbolIcon('const')).toBe('symbol-variable');
    expect(symbolIcon('whatever')).toBe('symbol-misc');
  });
});

describe('nodeForCaret', () => {
  const outline = [o('Foo', 1, 20, 'class'), o('Foo.bar', 5, 10, 'method')];

  it('at symbol level it is the innermost symbol around the line', () => {
    expect(nodeForCaret('symbol', 'f.ts', outline, 7)).toBe('f.ts::Foo.bar');
    expect(nodeForCaret('symbol', 'f.ts', outline, 15)).toBe('f.ts::Foo');
  });

  it('at symbol level a line outside any symbol maps to no node', () => {
    expect(nodeForCaret('symbol', 'f.ts', outline, 99)).toBeNull();
  });

  it('at coarser levels it is the file or its folder, wherever the line is', () => {
    expect(nodeForCaret('file', 'src/a/f.ts', outline, 99)).toBe('src/a/f.ts');
    expect(nodeForCaret('module', 'src/a/f.ts', outline, 1)).toBe('src/a');
  });
});
