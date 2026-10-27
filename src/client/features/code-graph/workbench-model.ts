/**
 * Pure model of the editor group: the pinned graph tab plus open source files.
 * Mirrors VSCode's tab rules (open right of the active tab, one reusable preview
 * tab, close activates a neighbour) so the shell stays a thin view over it.
 */

/** Id of the always-open, non-closable graph tab. */
export const GRAPH_TAB = 'graph';

/** What a file tab shows: a file, optionally scrolled to a span; `nonce` re-scrolls to the same one. */
export interface CodeTarget {
  file: string;
  range: [number, number] | null;
  nonce: number;
}

export interface FileTab extends CodeTarget {
  /** A preview tab is replaced by the next preview open, until it is pinned. */
  preview: boolean;
}

export interface EditorState {
  tabs: FileTab[];
  /**
   * `GRAPH_TAB` or the file of the active tab. While split the graph is its own group, not a
   * tab, so `GRAPH_TAB` then means the code group has no file open.
   */
  active: string;
  /** Graph and code side by side, as VSCode's "Split Editor Right". */
  split: boolean;
}

export const initialEditor: EditorState = { tabs: [], active: GRAPH_TAB, split: false };

export function activeFileTab(state: EditorState): FileTab | undefined {
  return state.tabs.find((t) => t.file === state.active);
}

export function openFileTab(state: EditorState, target: CodeTarget, { preview }: { preview: boolean }): EditorState {
  const existing = state.tabs.find((t) => t.file === target.file);
  if (existing) {
    const tab: FileTab = { ...target, preview: existing.preview && preview };
    return { ...state, tabs: state.tabs.map((t) => (t === existing ? tab : t)), active: target.file };
  }
  const tab: FileTab = { ...target, preview };
  // A new preview takes over the old preview's slot instead of piling up tabs.
  const previewAt = preview ? state.tabs.findIndex((t) => t.preview) : -1;
  if (previewAt >= 0) {
    const tabs = [...state.tabs];
    tabs[previewAt] = tab;
    return { ...state, tabs, active: target.file };
  }
  const at = state.tabs.findIndex((t) => t.file === state.active) + 1;
  return { ...state, tabs: [...state.tabs.slice(0, at), tab, ...state.tabs.slice(at)], active: target.file };
}

export function pinTab(state: EditorState, file: string): EditorState {
  if (!state.tabs.some((t) => t.file === file && t.preview)) return state;
  return { ...state, tabs: state.tabs.map((t) => (t.file === file ? { ...t, preview: false } : t)) };
}

export function activateTab(state: EditorState, id: string): EditorState {
  if (id === GRAPH_TAB ? state.split : !state.tabs.some((t) => t.file === id)) return state;
  return id === state.active ? state : { ...state, active: id };
}

export function closeTab(state: EditorState, file: string): EditorState {
  const at = state.tabs.findIndex((t) => t.file === file);
  if (at < 0) return state;
  const tabs = state.tabs.filter((_, i) => i !== at);
  if (state.active !== file) return { ...state, tabs };
  const neighbour = tabs[at] ?? tabs[at - 1];
  return { ...state, tabs, active: neighbour?.file ?? GRAPH_TAB };
}

export function toggleSplit(state: EditorState): EditorState {
  return { ...state, split: !state.split };
}
