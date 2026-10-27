import { describe, expect, it } from 'vitest';
import {
  GRAPH_TAB,
  activateTab,
  activeFileTab,
  closeTab,
  initialEditor,
  openFileTab,
  pinTab,
  toggleSplit,
  type EditorState,
} from '../workbench-model';

const open = (state: EditorState, file: string, opts: { preview?: boolean; range?: [number, number] } = {}) =>
  openFileTab(state, { file, range: opts.range ?? null, nonce: 1 }, { preview: opts.preview ?? false });

describe('openFileTab', () => {
  it('starts on the pinned graph tab with no files open', () => {
    expect(initialEditor).toEqual({ tabs: [], active: GRAPH_TAB, split: false });
    expect(activeFileTab(initialEditor)).toBeUndefined();
  });

  it('opens a file to the right of the active tab and activates it', () => {
    let s = open(initialEditor, 'a.ts');
    s = open(s, 'b.ts');
    s = activateTab(s, 'a.ts');
    s = open(s, 'c.ts');
    expect(s.tabs.map((t) => t.file)).toEqual(['a.ts', 'c.ts', 'b.ts']);
    expect(s.active).toBe('c.ts');
  });

  it('opens a file at the start while the graph tab is active', () => {
    let s = open(initialEditor, 'a.ts');
    s = activateTab(s, GRAPH_TAB);
    s = open(s, 'b.ts');
    expect(s.tabs.map((t) => t.file)).toEqual(['b.ts', 'a.ts']);
  });

  it('re-opening an open file activates it with the new scroll target instead of duplicating it', () => {
    let s = open(initialEditor, 'a.ts');
    s = open(s, 'b.ts');
    s = openFileTab(s, { file: 'a.ts', range: [10, 20], nonce: 2 }, { preview: false });
    expect(s.tabs.map((t) => t.file)).toEqual(['a.ts', 'b.ts']);
    expect(activeFileTab(s)).toMatchObject({ file: 'a.ts', range: [10, 20], nonce: 2 });
  });

  it('a preview open replaces the previous preview tab, like single-clicking in the explorer', () => {
    let s = open(initialEditor, 'a.ts', { preview: true });
    s = open(s, 'b.ts', { preview: true });
    expect(s.tabs).toEqual([{ file: 'b.ts', range: null, nonce: 1, preview: true }]);
  });

  it('a preview open never replaces a pinned tab', () => {
    let s = open(initialEditor, 'a.ts');
    s = open(s, 'b.ts', { preview: true });
    expect(s.tabs.map((t) => [t.file, t.preview])).toEqual([['a.ts', false], ['b.ts', true]]);
  });

  it('a pinned open of the preview file keeps the tab and pins it', () => {
    let s = open(initialEditor, 'a.ts', { preview: true });
    s = open(s, 'a.ts');
    expect(s.tabs).toEqual([{ file: 'a.ts', range: null, nonce: 1, preview: false }]);
  });

  it('a preview open of an already pinned file does not unpin it', () => {
    let s = open(initialEditor, 'a.ts');
    s = open(s, 'a.ts', { preview: true });
    expect(s.tabs[0].preview).toBe(false);
  });
});

describe('pinTab', () => {
  it('turns the preview tab into a regular one', () => {
    const s = pinTab(open(initialEditor, 'a.ts', { preview: true }), 'a.ts');
    expect(s.tabs[0].preview).toBe(false);
  });

  it('returns the same state for an unknown or already pinned file', () => {
    const s = open(initialEditor, 'a.ts');
    expect(pinTab(s, 'a.ts')).toBe(s);
    expect(pinTab(s, 'zzz.ts')).toBe(s);
  });
});

describe('closeTab', () => {
  const three = () => ['a.ts', 'b.ts', 'c.ts'].reduce((s, f) => open(s, f), initialEditor);

  it('closing the active tab activates its right neighbour', () => {
    const s = closeTab(activateTab(three(), 'b.ts'), 'b.ts');
    expect(s.tabs.map((t) => t.file)).toEqual(['a.ts', 'c.ts']);
    expect(s.active).toBe('c.ts');
  });

  it('closing the last active tab falls back to its left neighbour', () => {
    const s = closeTab(three(), 'c.ts');
    expect(s.active).toBe('b.ts');
  });

  it('closing the only file returns to the graph tab', () => {
    const s = closeTab(open(initialEditor, 'a.ts'), 'a.ts');
    expect(s).toEqual({ tabs: [], active: GRAPH_TAB, split: false });
  });

  it('closing an inactive tab keeps the active one', () => {
    const s = closeTab(three(), 'a.ts');
    expect(s.active).toBe('c.ts');
  });

  it('the graph tab cannot be closed', () => {
    const s = three();
    expect(closeTab(s, GRAPH_TAB)).toBe(s);
  });
});

describe('activateTab', () => {
  it('ignores ids that are not open', () => {
    const s = open(initialEditor, 'a.ts');
    expect(activateTab(s, 'nope.ts')).toBe(s);
  });
});

describe('split editor', () => {
  const split = (files: string[]) => toggleSplit(files.reduce((s, f) => open(s, f), initialEditor));

  it('turning it on keeps tabs and the active file', () => {
    const s = split(['a.ts', 'b.ts']);
    expect(s).toMatchObject({ split: true, active: 'b.ts' });
    expect(s.tabs.map((t) => t.file)).toEqual(['a.ts', 'b.ts']);
  });

  it('the graph is not a tab while split: activating it is ignored', () => {
    const s = split(['a.ts']);
    expect(activateTab(s, GRAPH_TAB)).toBe(s);
  });

  it('closing the last file leaves the code group empty but stays split', () => {
    const s = closeTab(split(['a.ts']), 'a.ts');
    expect(s).toEqual({ tabs: [], active: GRAPH_TAB, split: true });
    expect(activeFileTab(s)).toBeUndefined();
  });

  it('turning it off keeps the active file', () => {
    const s = toggleSplit(split(['a.ts', 'b.ts']));
    expect(s).toMatchObject({ split: false, active: 'b.ts' });
  });

  it('opening a file while split activates it without touching the split', () => {
    const s = open(toggleSplit(initialEditor), 'a.ts');
    expect(s).toMatchObject({ split: true, active: 'a.ts' });
  });
});
