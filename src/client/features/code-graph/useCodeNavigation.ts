import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { codeGraphSymbolQuery, codeGraphSymbolSearchQuery } from '../../hooks/queries/useCodeGraph';
import type { CodeGraphOutlineDTO, CodeGraphSymbolRefDTO } from '../../lib/types';
import {
  declarationCandidates,
  emptyHistory,
  goBack,
  goForward,
  isDoubleShift,
  memberName,
  pushHistory,
  resolveIdentifier,
  type NavHistory,
  type NavLocation,
} from './nav-model';
import type { FileTab } from './workbench-model';
import type { QuickOpenHandle } from './QuickOpen';

/** Quick-open rows asked for by the app rather than typed: Ctrl+click with several (or no) declarations. */
export interface Choices { title: string; items: CodeGraphSymbolRefDTO[]; from: NavLocation | null }

/**
 * IDE-style code navigation: back/forward history, go to symbol / usage / declaration, the
 * symbol the details pane follows, and the global shortcuts (Double Shift, Alt+←/→, Ctrl+\\).
 * The page owns the editor and graph state; this owns where the user has been and is going.
 */
export function useCodeNavigation({ projectPath, rev, activeTab, activeOutline, openFile, setAuxOpen, setQuery, searchRef, splitRef, errorMessage }: {
  projectPath: string | undefined;
  rev: string | undefined;
  activeTab: FileTab | undefined;
  activeOutline: CodeGraphOutlineDTO[] | undefined;
  openFile: (file: string, range?: [number, number] | null, symbolId?: string | null, preview?: boolean) => void;
  setAuxOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  searchRef: RefObject<QuickOpenHandle | null>;
  /** Toggles the split editor; held in a ref so the keyboard listener never goes stale. */
  splitRef: RefObject<() => void>;
  errorMessage: (err: unknown) => string;
}) {
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<NavHistory>(emptyHistory);
  /** The symbol the details pane shows while a file is open: set by navigation, not by scrolling. */
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  useEffect(() => {
    setHistory(emptyHistory);
    setInspectedId(null);
  }, [projectPath]);

  /** Where the user is now, for the way back: the active file at its last navigated span. */
  const here = (): NavLocation | null => (activeTab ? { file: activeTab.file, range: activeTab.range } : null);
  const dismissQuickOpen = () => {
    setQuery('');
    setChoices(null);
  };
  /** Go to a declaration as an IDE does: remember where we were, open it, and show it in the details pane. */
  const goToSymbol = (s: CodeGraphSymbolRefDTO, from: NavLocation | null = here(), preview = false) => {
    setHistory((h) => pushHistory(h, from));
    openFile(s.file, [s.startLine, s.endLine], s.id, preview);
    setInspectedId(s.id);
    setAuxOpen(true);
  };
  /** Open a usage at its line, keeping the inspected symbol so its usages list stays in place. */
  const goToUsage = (s: CodeGraphSymbolRefDTO, line?: number) => {
    setHistory((h) => pushHistory(h, here()));
    openFile(s.file, line ? [line, line] : [s.startLine, s.endLine], s.id, false);
  };
  const travel = (dir: 'back' | 'forward') => {
    const step = (dir === 'back' ? goBack : goForward)(history, here());
    if (!step) return;
    setHistory(step.history);
    openFile(step.target.file, step.target.range, null, false);
  };
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const pickDeclaration = (title: string, items: CodeGraphSymbolRefDTO[], from: NavLocation | null) => {
    setQuery('');
    setChoices({ title, items, from });
    searchRef.current?.focus();
  };
  /**
   * The declarations `name` at `line` of `file` most likely means, off what the enclosing
   * symbols call and name, then a project-wide search by name. Shared with the peek.
   */
  const resolveDeclaration = async (name: string, file: string, line: number, outline: readonly CodeGraphOutlineDTO[]) => {
    if (!projectPath) return [];
    const enclosing = outline.filter((s) => s.startLine <= line && s.endLine >= line);
    const around = await Promise.all(enclosing.map((s) => queryClient.fetchQuery(codeGraphSymbolQuery(projectPath, s.id, rev))));
    let targets: CodeGraphSymbolRefDTO[] = resolveIdentifier(name, line, [
      ...around.flatMap((d) => declarationCandidates(d, [], file)),
      ...declarationCandidates(undefined, outline, file),
    ]);
    if (targets.length === 0) {
      const hits = await queryClient.fetchQuery(codeGraphSymbolSearchQuery(projectPath, name, rev));
      targets = hits.filter((h) => memberName(h.symbol) === name);
    }
    return targets;
  };
  /**
   * Ctrl+click: on a declaration, its usages (as IntelliJ does); elsewhere, the declaration the
   * name most likely means. Several equally likely targets open a chooser.
   */
  const goToDeclaration = async (name: string, line: number) => {
    if (!activeTab || !projectPath) return;
    const file = activeTab.file;
    const from: NavLocation = { file, range: [line, line] };
    const outline = activeOutline ?? [];
    const declared = outline.find((s) => s.startLine === line && memberName(s.symbol) === name);
    if (declared) {
      setInspectedId(declared.id);
      setAuxOpen(true);
      return;
    }
    try {
      const targets = await resolveDeclaration(name, file, line, outline);
      if (targets.length === 1) goToSymbol(targets[0], from);
      else pickDeclaration(targets.length ? `Choose declaration of ${name}` : `No declaration of ${name} in the index`, targets, from);
    } catch (err) {
      pickDeclaration(`Could not resolve ${name}: ${errorMessage(err)}`, [], from);
    }
  };
  /** A symbol of the open file picked from its gutter or the structure view. */
  const selectInFile = (s: CodeGraphOutlineDTO) => {
    if (activeTab) goToSymbol({ ...s, file: activeTab.file }, here(), activeTab.preview);
  };

  // Double Shift opens symbol search (IntelliJ's Search Everywhere); Alt+←/→ walk the history.
  useEffect(() => {
    let lastShift: number | null = null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const now = performance.now();
        if (isDoubleShift(lastShift, now)) {
          lastShift = null;
          searchRef.current?.focus();
        } else lastShift = now;
        return;
      }
      lastShift = null;
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        splitRef.current();
        return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        travelRef.current(e.key === 'ArrowLeft' ? 'back' : 'forward');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { history, inspectedId, choices, setChoices, here, dismissQuickOpen, goToSymbol, goToUsage, travel, goToDeclaration, resolveDeclaration, selectInFile };
}
