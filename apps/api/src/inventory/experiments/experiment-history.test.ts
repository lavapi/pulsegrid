import { describe, expect, it } from 'vitest';
import { historyCsv, historyEntries, type HistoryRun } from './experiment-history';
import type { ReportRow } from './experiment-report.store';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const REGION = 'eu-central-1';

const report = (experimentId: string, state: ReportRow['state'], label = 'Database failover'): ReportRow => ({
  id: `report-${experimentId}`,
  tenant_id: 't',
  cloud_account_id: 'a',
  region: REGION,
  experiment_id: experimentId,
  template_id: 'EXT1',
  label,
  account_name: 'Staging account',
  environment_name: 'Staging',
  is_production: false,
  started_by_email: 'dev@example.test',
  state,
  reason: null,
  started_at: new Date('2026-11-11T10:00:00.000Z'),
  ended_at: new Date(`2026-11-11T10:${experimentId === 'E2' ? '20' : '10'}:00.000Z`),
  details: { description: null, steps: [], targets: [], stopAlarms: [], resourceIds: [] },
  created_at: NOW,
});

const run = (startedAt: string, experimentIds: (string | null)[]): HistoryRun => ({
  id: `run-${startedAt}`,
  label: 'Data layer',
  items: experimentIds.map((experimentId, index) => ({
    region: REGION,
    templateId: `EXT${index}`,
    label: `Test ${index}`,
    experimentId,
    error: experimentId ? null : 'AWS refused this experiment.',
  })),
  started_by_email: 'dev@example.test',
  started_at: new Date(startedAt),
  cloud_account_id: 'a',
  account_name: 'Staging account',
  environment_name: 'Staging',
});

describe('historyEntries', () => {
  it('shows a group run as one entry with its counts, and single tests on their own', () => {
    const entries = historyEntries(
      [run('2026-11-11T10:00:00.000Z', ['E1', 'E2'])],
      [report('E1', 'completed'), report('E2', 'stopped'), report('E3', 'completed', 'Cache reboot')],
      {},
      NOW,
    );
    expect(entries.map(({ kind, label }) => `${kind}:${label}`)).toEqual(['run:Data layer', 'test:Cache reboot']);
    expect(entries[0]).toMatchObject({
      result: 'stopped',
      endedAt: '2026-11-11T10:20:00.000Z',
      counts: { total: 2, passed: 1, stopped: 1, failed: 0, notStarted: 0 },
    });
  });

  it('fails a run with a test that did not start, and passes one where every test completed', () => {
    const [failed] = historyEntries([run('2026-11-11T10:00:00.000Z', ['E1', null])], [report('E1', 'completed')], {}, NOW);
    expect(failed).toMatchObject({ result: 'failed', counts: { notStarted: 1 } });
    const [passed] = historyEntries([run('2026-11-11T10:00:00.000Z', ['E1'])], [report('E1', 'completed')], {}, NOW);
    expect(passed?.result).toBe('passed');
  });

  it('keeps a run running until its results are saved, and unknown once AWS can no longer have them', () => {
    expect(historyEntries([run('2026-11-11T11:00:00.000Z', ['E9'])], [], {}, NOW)[0]?.result).toBe('running');
    expect(historyEntries([run('2026-11-10T11:00:00.000Z', ['E9'])], [], {}, NOW)[0]?.result).toBe('unknown');
  });

  it('filters by environment, name and result', () => {
    const runs = [run('2026-11-11T10:00:00.000Z', ['E1'])];
    const reports = [report('E1', 'completed'), report('E3', 'failed', 'Cache reboot')];
    expect(historyEntries(runs, reports, { result: 'failed' }, NOW).map(({ label }) => label)).toEqual(['Cache reboot']);
    expect(historyEntries(runs, reports, { label: 'Data layer' }, NOW)).toHaveLength(1);
    expect(historyEntries(runs, reports, { environment: 'Production' }, NOW)).toEqual([]);
  });
});

describe('historyCsv', () => {
  it('writes one row per entry and neutralises spreadsheet formulas', () => {
    const entries = historyEntries([], [report('E1', 'completed', '=HYPERLINK("x")')], {}, NOW);
    const [header, row] = historyCsv(entries).split('\n');
    expect(header).toContain('Result,Started,Ended,Minutes');
    expect(row).toContain(`"'=HYPERLINK(""x"")"`);
    expect(row).toContain(',passed,');
    expect(row).toContain(',10,');
  });
});
