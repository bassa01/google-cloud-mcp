import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseRelativeTime } from '../../../src/utils/time.js';
import { GcpMcpError } from '../../../src/utils/error.js';

describe('parseRelativeTime', () => {
  const fixedNow = new Date('2024-01-01T00:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an ISO date when provided with a timestamp-like string', () => {
    const iso = '2023-12-31T23:45:00.000Z';
    const result = parseRelativeTime(iso);

    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(iso);
  });

  it.each([
    ['15s', 15 * 1000],
    ['5m', 5 * 60 * 1000],
    ['2h', 2 * 60 * 60 * 1000],
    ['3d', 3 * 24 * 60 * 60 * 1000],
    ['1w', 7 * 24 * 60 * 60 * 1000],
  ])('parses %s relative offset from now', (input, delta) => {
    const result = parseRelativeTime(input);

    expect(result.getTime()).toBe(fixedNow.getTime() - delta);
  });

  it('throws a typed error for unsupported formats', () => {
    expect(() => parseRelativeTime('invalid-input')).toThrow(GcpMcpError);
  });
});
