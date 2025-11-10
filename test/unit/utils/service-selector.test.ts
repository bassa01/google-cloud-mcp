import { describe, it, expect } from 'vitest';
import {
  getEnabledServices,
  isServiceEnabled,
  parseServiceSelection,
  SERVICE_NAMES,
} from '../../../src/utils/service-selector.js';

describe('service selector', () => {
  it('defaults to all services when env is missing', () => {
    const selection = parseServiceSelection(undefined);

    expect(selection.mode).toBe('all');
    expect(selection.invalidEntries).toHaveLength(0);
    expect(getEnabledServices(selection)).toEqual(Array.from(SERVICE_NAMES));
    for (const service of SERVICE_NAMES) {
      expect(isServiceEnabled(selection, service)).toBe(true);
    }
  });

  it('parses a custom subset case-insensitively', () => {
    const selection = parseServiceSelection('Spanner, trace , LOGGING');
    const enabled = getEnabledServices(selection);

    expect(selection.mode).toBe('custom');
    expect(selection.invalidEntries).toHaveLength(0);
    expect(enabled).toHaveLength(3);
    expect(enabled).toEqual(
      expect.arrayContaining(['spanner', 'trace', 'logging']),
    );
    expect(isServiceEnabled(selection, 'spanner')).toBe(true);
    expect(isServiceEnabled(selection, 'profiler')).toBe(false);
  });

  it('treats * or all as wildcards for every service', () => {
    const selection = parseServiceSelection('*,spanner');

    expect(selection.mode).toBe('all');
    expect(selection.invalidEntries).toHaveLength(0);
    expect(getEnabledServices(selection)).toEqual(Array.from(SERVICE_NAMES));
  });

  it('records invalid entries without preventing valid matches', () => {
    const selection = parseServiceSelection('trace,unknown,metrics');

    expect(selection.mode).toBe('custom');
    expect(selection.invalidEntries).toEqual(['unknown']);
    const enabled = getEnabledServices(selection);
    expect(enabled).toHaveLength(2);
    expect(enabled).toEqual(expect.arrayContaining(['trace', 'monitoring']));
  });

  it('falls back to all services when every entry is invalid', () => {
    const selection = parseServiceSelection('foo,bar');

    expect(selection.mode).toBe('all');
    expect(selection.invalidEntries).toEqual(['foo', 'bar']);
    expect(getEnabledServices(selection)).toEqual(Array.from(SERVICE_NAMES));
  });
});
