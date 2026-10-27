/**
 * Which workbench parts a page is currently filling. The shell renders a part only
 * while something occupies it; counts (not booleans) let two components share a slot.
 */

export type SlotName =
  | 'titleStart'
  | 'titleCenter'
  | 'titleEnd'
  | 'activity'
  | 'sideBar'
  /** A section a dashboard page adds under the navigation side bar. */
  | 'sideBarSection'
  | 'panel'
  | 'auxBar'
  | 'statusStart'
  | 'statusEnd';

export type SlotsState = Readonly<Partial<Record<SlotName, number>>>;

export type SlotsAction = { type: 'register' | 'unregister'; name: SlotName };

export const EMPTY_SLOTS: SlotsState = {};

export function slotsReducer(state: SlotsState, { type, name }: SlotsAction): SlotsState {
  const count = state[name] ?? 0;
  const next = type === 'register' ? count + 1 : Math.max(0, count - 1);
  return next === count ? state : { ...state, [name]: next };
}

export function isOccupied(state: SlotsState, name: SlotName): boolean {
  return (state[name] ?? 0) > 0;
}
