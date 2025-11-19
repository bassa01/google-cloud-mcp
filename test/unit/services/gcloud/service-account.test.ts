import { describe, it, expect, vi, beforeEach } from 'vitest';

const getActiveGcloudAccountMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/services/gcloud/cli.js', () => ({
  getActiveGcloudAccount: getActiveGcloudAccountMock,
}));

import {
  extractImpersonatedServiceAccount,
  isServiceAccountEmail,
  requireServiceAccountIdentity,
} from '../../../../src/services/gcloud/service-account.js';

describe('gcloud service account guardrails', () => {
  const mockedGetActiveAccount = () => vi.mocked(getActiveGcloudAccountMock);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isServiceAccountEmail', () => {
    it('identifies valid service account suffixes case-insensitively', () => {
      expect(isServiceAccountEmail('bot@project.iam.gserviceaccount.com')).toBe(true);
      expect(isServiceAccountEmail('BOT@PROJECT.IAM.GSERVICEACCOUNT.COM')).toBe(true);
      expect(isServiceAccountEmail('user@example.com')).toBe(false);
      expect(isServiceAccountEmail(undefined)).toBe(false);
    });
  });

  describe('extractImpersonatedServiceAccount', () => {
    it('detects equals style impersonation flags', () => {
      const account = extractImpersonatedServiceAccount([
        '--project=test',
        '--impersonate-service-account=bot@example.iam.gserviceaccount.com',
        'projects',
        'list',
      ]);
      expect(account).toBe('bot@example.iam.gserviceaccount.com');
    });

    it('detects space separated impersonation flags', () => {
      const account = extractImpersonatedServiceAccount([
        '--format=json',
        '--impersonate-service-account',
        'bot@example.iam.gserviceaccount.com',
        'projects',
        'list',
      ]);
      expect(account).toBe('bot@example.iam.gserviceaccount.com');
    });

    it('returns null when no impersonation occurs', () => {
      expect(extractImpersonatedServiceAccount(['projects', 'list'])).toBeNull();
    });
  });

  describe('requireServiceAccountIdentity', () => {
    it('allows explicit service account impersonation', async () => {
      const identity = await requireServiceAccountIdentity([
        '--impersonate-service-account=bot@example.iam.gserviceaccount.com',
        'projects',
        'list',
      ]);
      expect(identity).toBe('bot@example.iam.gserviceaccount.com');
      expect(getActiveGcloudAccountMock).not.toHaveBeenCalled();
    });

    it('rejects impersonation of non-service accounts', async () => {
      await expect(
        requireServiceAccountIdentity([
          '--impersonate-service-account=user@example.com',
        ]),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_IDENTITY', statusCode: 403 });
    });

    it('enforces that the active gcloud account is a service account', async () => {
      mockedGetActiveAccount().mockResolvedValueOnce(
        'bot@example.iam.gserviceaccount.com',
      );

      await expect(
        requireServiceAccountIdentity(['projects', 'list']),
      ).resolves.toBe('bot@example.iam.gserviceaccount.com');
      expect(getActiveGcloudAccountMock).toHaveBeenCalled();
    });

    it('raises UNAUTHENTICATED when no active identity is present', async () => {
      mockedGetActiveAccount().mockResolvedValueOnce(null);

      await expect(
        requireServiceAccountIdentity(['projects', 'list']),
      ).rejects.toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    });

    it('requires the active identity to be a service account', async () => {
      mockedGetActiveAccount().mockResolvedValueOnce('user@example.com');

      await expect(
        requireServiceAccountIdentity(['projects', 'list']),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_IDENTITY', statusCode: 403 });
    });
  });
});
