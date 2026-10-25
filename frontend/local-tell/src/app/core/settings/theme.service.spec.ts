import { resolveTheme } from './theme.service';

describe('Android System/Light/Dark theme policy', () => {
  it('follows the operating system only in System mode', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});