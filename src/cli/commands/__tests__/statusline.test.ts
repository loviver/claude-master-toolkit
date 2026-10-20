import { describe, it, expect } from 'vitest';
import { renderStatusline } from '../statusline.js';

describe('renderStatusline', () => {
  it('renders today + session cost with model', () => {
    expect(renderStatusline({ todayCost: 1.234, sessionCost: 0.456, model: 'claude-opus-4-8' }))
      .toBe('$1.23 today · $0.46 session · claude-opus-4-8');
  });

  it('omits the model segment when model is absent', () => {
    expect(renderStatusline({ todayCost: 1.2, sessionCost: 0.4 }))
      .toBe('$1.20 today · $0.40 session');
  });

  it('formats zero costs to two decimals', () => {
    expect(renderStatusline({ todayCost: 0, sessionCost: 0 }))
      .toBe('$0.00 today · $0.00 session');
  });

  it('treats empty-string model as absent', () => {
    expect(renderStatusline({ todayCost: 0, sessionCost: 0, model: '' }))
      .toBe('$0.00 today · $0.00 session');
  });
});
