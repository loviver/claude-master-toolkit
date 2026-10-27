import { describe, expect, it } from 'vitest';
import { EMPTY_SLOTS, isOccupied, slotsReducer } from '../slot-model';

describe('slotsReducer', () => {
  it('starts with every slot empty', () => {
    expect(isOccupied(EMPTY_SLOTS, 'sideBar')).toBe(false);
    expect(isOccupied(EMPTY_SLOTS, 'panel')).toBe(false);
  });

  it('marks a slot occupied once something registers into it', () => {
    const s = slotsReducer(EMPTY_SLOTS, { type: 'register', name: 'sideBar' });
    expect(isOccupied(s, 'sideBar')).toBe(true);
    expect(isOccupied(s, 'panel')).toBe(false);
  });

  it('frees a slot only when its last registrant leaves', () => {
    let s = slotsReducer(EMPTY_SLOTS, { type: 'register', name: 'statusEnd' });
    s = slotsReducer(s, { type: 'register', name: 'statusEnd' });
    s = slotsReducer(s, { type: 'unregister', name: 'statusEnd' });
    expect(isOccupied(s, 'statusEnd')).toBe(true);
    s = slotsReducer(s, { type: 'unregister', name: 'statusEnd' });
    expect(isOccupied(s, 'statusEnd')).toBe(false);
  });

  it('never goes negative on a stray unregister', () => {
    const s = slotsReducer(EMPTY_SLOTS, { type: 'unregister', name: 'auxBar' });
    expect(isOccupied(s, 'auxBar')).toBe(false);
    expect(isOccupied(slotsReducer(s, { type: 'register', name: 'auxBar' }), 'auxBar')).toBe(true);
  });

  it('keeps the same state object when nothing changes, so React can bail out', () => {
    expect(slotsReducer(EMPTY_SLOTS, { type: 'unregister', name: 'panel' })).toBe(EMPTY_SLOTS);
  });
});
