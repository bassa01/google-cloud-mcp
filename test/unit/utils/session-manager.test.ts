import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '../../../src/utils/session-manager.js';

const ADVANCE_HOURS = (hours: number): number => hours * 60 * 60 * 1000;

describe('SessionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates and validates sessions with isolated metadata', () => {
    const manager = new SessionManager({ autoCleanup: false });
    const sessionId = manager.createSession({ actor: 'initial' });

    expect(sessionId).toMatch(/^mcp_[a-z0-9]+_/);
    expect(manager.validateSession(sessionId)).toBe(true);

    expect(manager.getSessionMetadata(sessionId)).toEqual({ actor: 'initial' });

    manager.updateSessionMetadata(sessionId, { scope: 'read-only' });
    expect(manager.getSessionMetadata(sessionId)).toEqual({
      actor: 'initial',
      scope: 'read-only',
    });

    const metadata = manager.getSessionMetadata(sessionId);
    expect(metadata).toEqual({ actor: 'initial', scope: 'read-only' });
    metadata!.scope = 'mutated';

    expect(manager.getSessionMetadata(sessionId)).toEqual({
      actor: 'initial',
      scope: 'read-only',
    });
  });

  it('rotates session identifiers up to the limit and invalidates afterwards', () => {
    const manager = new SessionManager({ autoCleanup: false });
    const created = manager.createSession({});
    let currentId = created;

    for (let i = 0; i < 10; i += 1) {
      const rotated = manager.rotateSessionId(currentId);
      expect(rotated).toBeTruthy();
      expect(rotated).not.toBe(currentId);
      currentId = rotated!;
      expect(manager.validateSession(currentId)).toBe(true);
    }

    expect(manager.rotateSessionId(currentId)).toBeNull();
    expect(manager.validateSession(currentId)).toBe(false);
  });

  it('expires sessions after the configured lifetime', () => {
    const manager = new SessionManager({ autoCleanup: false });
    const sessionId = manager.createSession();

    vi.advanceTimersByTime(ADVANCE_HOURS(25));
    vi.setSystemTime(new Date('2024-01-02T01:00:00.000Z'));

    expect(manager.validateSession(sessionId)).toBe(false);
    expect(manager.getSessionMetadata(sessionId)).toBeNull();
  });

  it('cleans up expired sessions and reports the count', () => {
    const manager = new SessionManager({ autoCleanup: false });
    const expired = manager.createSession();

    vi.advanceTimersByTime(ADVANCE_HOURS(25));
    vi.setSystemTime(new Date('2024-01-02T01:00:00.000Z'));

    const active = manager.createSession();

    expect(manager.cleanupExpiredSessions()).toBe(1);
    expect(manager.getSessionMetadata(expired)).toBeNull();
    expect(manager.getSessionMetadata(active)).not.toBeNull();
  });
});
