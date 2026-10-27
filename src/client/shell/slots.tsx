import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { EMPTY_SLOTS, isOccupied, slotsReducer, type SlotName } from './slot-model';
import styles from './workbench/Workbench.module.css';

interface SlotsContextValue {
  targets: Partial<Record<SlotName, HTMLElement>>;
  refs: Record<SlotName, (el: HTMLElement | null) => void>;
  register: (name: SlotName) => () => void;
  setPanelCollapsed: (collapsed: boolean) => void;
}

const SlotsContext = createContext<SlotsContextValue | null>(null);

/**
 * Lets a routed page fill workbench parts (side bar, panel, title/status bar entries)
 * that live outside its own subtree. Content is portaled into targets the shell owns,
 * so no ReactNode ever travels through state and the editor never remounts.
 */
export function useSlotsHost() {
  const [slots, dispatch] = useReducer(slotsReducer, EMPTY_SLOTS);
  const [targets, setTargets] = useState<SlotsContextValue['targets']>({});
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const register = useCallback((name: SlotName) => {
    dispatch({ type: 'register', name });
    return () => dispatch({ type: 'unregister', name });
  }, []);

  // One stable callback ref per slot, so React does not detach/reattach targets each render.
  const refs = useMemo(() => {
    const make = (name: SlotName) => (el: HTMLElement | null) => setTargets((prev) => {
      if ((prev[name] ?? null) === el) return prev;
      const next = { ...prev };
      if (el) next[name] = el;
      else delete next[name];
      return next;
    });
    return {
      titleStart: make('titleStart'),
      titleCenter: make('titleCenter'),
      titleEnd: make('titleEnd'),
      activity: make('activity'),
      sideBar: make('sideBar'),
      sideBarSection: make('sideBarSection'),
      panel: make('panel'),
      auxBar: make('auxBar'),
      statusStart: make('statusStart'),
      statusEnd: make('statusEnd'),
    } satisfies Record<SlotName, (el: HTMLElement | null) => void>;
  }, []);

  const context = useMemo<SlotsContextValue>(
    () => ({ targets, refs, register, setPanelCollapsed }),
    [targets, refs, register],
  );

  /** The portal target for a slot; parts gated on occupancy render it only while filled. */
  const target = (name: SlotName) => <div ref={refs[name]} className={styles.slotTarget} />;

  return {
    context,
    occupied: (name: SlotName) => isOccupied(slots, name),
    panelCollapsed,
    target,
  };
}

export function SlotsProvider({ value, children }: { value: SlotsContextValue; children: ReactNode }) {
  return <SlotsContext.Provider value={value}>{children}</SlotsContext.Provider>;
}

/** A portal target rendered by a page itself, for slots nested inside its own parts. */
export function SlotTarget({ name }: { name: SlotName }) {
  const ctx = useContext(SlotsContext);
  if (!ctx) throw new Error('SlotTarget must render inside the AppShell');
  return <div ref={ctx.refs[name]} className={styles.slotTarget} />;
}

/** Renders `children` into a workbench part owned by the shell. */
export function WorkbenchSlot({ name, collapsed = false, children }: {
  name: SlotName;
  /** Panel only: shrink it to its header. */
  collapsed?: boolean;
  children: ReactNode;
}) {
  const ctx = useContext(SlotsContext);
  if (!ctx) throw new Error('WorkbenchSlot must render inside the AppShell');
  const { register, setPanelCollapsed, targets } = ctx;

  useLayoutEffect(() => register(name), [register, name]);
  useLayoutEffect(() => {
    if (name !== 'panel') return;
    setPanelCollapsed(collapsed);
    return () => setPanelCollapsed(false);
  }, [name, collapsed, setPanelCollapsed]);

  const el = targets[name];
  return el ? createPortal(children, el) : null;
}
