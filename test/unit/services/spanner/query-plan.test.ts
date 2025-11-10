/**
 * Tests for Spanner query plan utilities
 */
import { describe, it, expect } from 'vitest';

describe('Spanner Query Plan Utilities', () => {
  it('formats plan rows into markdown', async () => {
    const { formatPlanRowsAsMarkdown } = await import('../../../../src/services/spanner/query-plan.js');

    const markdown = formatPlanRowsAsMarkdown([
      { plan_node_id: '1', operator: 'Input', rows: 10 },
      { plan_node_id: '2', operator: 'Output', rows: 5 },
    ]);

    expect(markdown).toContain('| plan_node_id | operator | rows |');
    expect(markdown).toContain('Input');
    expect(markdown).toContain('Output');
  });

  it('detects distributed joins and missing indexes', async () => {
    const { analyzeQueryPlan } = await import('../../../../src/services/spanner/query-plan.js');

    const schema = {
      tables: [
        {
          name: 'Orders',
          columns: [],
          indexes: [{ name: 'PRIMARY KEY', columns: ['id'] }],
        },
      ],
    };

    const planRows = [
      {
        plan_node_id: '3',
        operator: 'Distributed Hash Join',
      },
      {
        plan_node_id: '4',
        operator: 'Table Scan',
        table: 'Orders',
        name: 'Table Scan Orders',
      },
    ];

    const result = analyzeQueryPlan(planRows, schema, 'SELECT * FROM Orders');

    expect(result.distributedJoinIssues.length).toBeGreaterThan(0);
    expect(result.missingIndexIssues.length).toBeGreaterThan(0);
    expect(result.referencedTables).toContain('Orders');
  });
});
