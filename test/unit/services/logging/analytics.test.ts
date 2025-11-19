import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const analyticsModulePath = '../../../../src/services/logging/analytics.js';
const originalEnv = process.env;

async function importAnalytics() {
  return import(analyticsModulePath);
}

describe('Logging analytics helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.LOG_ANALYTICS_LOCATION;
    delete process.env.LOG_ANALYTICS_BUCKET;
    delete process.env.LOG_ANALYTICS_VIEW;
    delete process.env.LOG_ANALYTICS_ROW_PREVIEW_LIMIT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveLogViewSelection', () => {
    it('parses an explicit resource name', async () => {
      const { resolveLogViewSelection } = await importAnalytics();

      const selection = resolveLogViewSelection(
        {
          resourceName:
            'projects/demo/locations/us-central1/buckets/_Default/views/_AllLogs',
        },
        'fallback-project',
      );

      expect(selection).toEqual({
        projectId: 'demo',
        location: 'us-central1',
        bucketId: '_Default',
        viewId: '_AllLogs',
      });
    });

    it('falls back to environment defaults and trims overrides', async () => {
      process.env.LOG_ANALYTICS_LOCATION = '  asia-northeast1  ';
      process.env.LOG_ANALYTICS_BUCKET = ' custom-bucket ';
      process.env.LOG_ANALYTICS_VIEW = ' custom-view ';

      const { resolveLogViewSelection } = await importAnalytics();

      const selection = resolveLogViewSelection(
        {
          projectId: '  manual-project  ',
          location: '  europe-west1  ',
        },
        'fallback-project',
      );

      expect(selection).toEqual({
        projectId: 'manual-project',
        location: 'europe-west1',
        bucketId: 'custom-bucket',
        viewId: 'custom-view',
      });
    });

    it('rejects malformed resource names', async () => {
      const { resolveLogViewSelection } = await importAnalytics();

      expect(() =>
        resolveLogViewSelection(
          {
            resourceName: 'invalid-format',
          },
          'demo',
        ),
      ).toThrowError(/Invalid log view resource name/);
    });
  });

  describe('resource builders', () => {
    it('constructs canonical resource names and SQL identifiers', async () => {
      const { buildLogViewResourceName, buildSqlViewIdentifier } =
        await importAnalytics();

      const selection = {
        projectId: 'demo-project',
        location: 'us-central1',
        bucketId: 'custom-bucket',
        viewId: 'view-alpha',
      };

      expect(buildLogViewResourceName(selection)).toBe(
        'projects/demo-project/locations/us-central1/buckets/custom-bucket/views/view-alpha',
      );
      const identifier = buildSqlViewIdentifier({
        projectId: 'demo-project',
        location: 'global',
        bucketId: 'bucket-with-dash',
        viewId: 'view`name',
      });

      expect(identifier).toContain('`demo-project`');
      expect(identifier).toContain('.global.');
      expect(identifier).toContain('`bucket-with-dash`');
      expect(identifier).toMatch(/`view\\`name`$/);
    });
  });

  describe('buildRestrictionSummary', () => {
    it('summarizes multiple conflicts with location hints', async () => {
      const { buildRestrictionSummary } = await importAnalytics();

      expect(buildRestrictionSummary(undefined)).toBeUndefined();

      const summary = buildRestrictionSummary([
        { type: 'VISIBILITY', line: 3, column: 7 },
        { type: 'POLICY', line: '10', column: '2' },
        { type: 'UNKNOWN' },
      ]);

      expect(summary).toBe(
        'Restrictions not applied: VISIBILITY conflict at line 3, column 7; POLICY conflict at line 10, column 2; UNKNOWN conflict.',
      );
    });
  });

  describe('formatLogAnalyticsRowsResponse', () => {
    it('embeds structured preview metadata, context, and notes', async () => {
      const { formatLogAnalyticsRowsResponse } = await importAnalytics();

      const formatted = formatLogAnalyticsRowsResponse({
        title: 'Log Analytics Preview',
        metadata: {
          totalRows: 10,
          rowLimit: 5,
          resultReference: 'jobs/demo',
        },
        rows: [{ severity: 'ERROR', count: 3 }],
        context: { query: 'SELECT severity, COUNT(*)' },
        additionalNote: 'Cache disabled for this query.',
      });

      expect(formatted).toContain('Log Analytics Preview');
      expect(formatted).toContain('rowsReturned=1');
      expect(formatted).toContain('resultReference=jobs/demo');
      expect(formatted).toContain('Showing 1 of 10 row (preview limit 5).');
      expect(formatted).toContain('Cache disabled for this query.');
      expect(formatted).toContain('```json');
      expect(formatted).toContain('"query"');
      expect(formatted).toContain('"rows"');
      expect(formatted).toContain('"severity": "ERROR"');
    });
  });
});
