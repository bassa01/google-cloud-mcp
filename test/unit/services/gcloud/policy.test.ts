import { describe, it, expect } from 'vitest';
import {
  checkCommandAgainstPolicy,
  enforceReadOnlyPolicy,
} from '../../../../src/services/gcloud/policy.js';

describe('gcloud policy', () => {
  it('allows standard read-only commands', () => {
    const violation = checkCommandAgainstPolicy('compute instances list', [
      'compute',
      'instances',
      'list',
    ]);
    expect(violation).toBeNull();
    expect(() =>
      enforceReadOnlyPolicy('logging read', ['logging', 'read']),
    ).not.toThrow();
  });

  it('blocks mutating verbs', () => {
    const violation = checkCommandAgainstPolicy('projects delete', [
      'projects',
      'delete',
    ]);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('UNSAFE_VERB');
  });

  it('blocks IAM surfaces regardless of verb', () => {
    const violation = checkCommandAgainstPolicy(
      'iam service-accounts list',
      ['iam', 'service-accounts', 'list'],
    );
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('SENSITIVE_COMMAND');
  });

  it('blocks secret manager commands', () => {
    const violation = checkCommandAgainstPolicy(
      'secret-manager secrets describe',
      ['secret-manager', 'secrets', 'describe'],
    );
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('SENSITIVE_COMMAND');
  });

  it('blocks ssh style commands', () => {
    const violation = checkCommandAgainstPolicy('compute ssh', [
      'compute',
      'ssh',
    ]);
    expect(violation).not.toBeNull();
  });

  it('blocks commands containing forbidden keywords in args', () => {
    const violation = checkCommandAgainstPolicy('logging read', [
      'logging',
      'read',
      '--filter',
      'severity=ERROR delete',
    ]);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('UNSAFE_OPERATION');
  });

  it('blocks export operations surfaced in arguments', () => {
    const violation = checkCommandAgainstPolicy('sql operations list', [
      'sql',
      'operations',
      'list',
      '--format=json',
      'export',
      'gs://bucket/path',
    ]);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe('UNSAFE_OPERATION');
  });
});
