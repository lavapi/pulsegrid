import type { ExperimentRunDetail, ExperimentRunItemState } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { renderReportPdf } from './report-pdf';
import { pdfName, runPdf, safeTimeZone } from './report-pdf-data';

const item = (overrides: Partial<ExperimentRunItemState>): ExperimentRunItemState => ({
  region: 'eu-central-1',
  templateId: 'EXT1',
  label: 'Stop game proxies',
  experimentId: null,
  error: null,
  state: null,
  report: null,
  ...overrides,
});

const run = (items: ExperimentRunItemState[], stoppedReason: string | null = null) =>
  ({
    id: 'r',
    label: 'All tests',
    startedAt: '2026-11-11T21:50:00.000Z',
    endedAt: '2026-11-11T22:30:00.000Z',
    startedBy: 'dev@example.test',
    result: 'failed',
    accountName: 'Production account',
    environmentName: 'Production',
    stoppedReason,
    items,
  }) as unknown as ExperimentRunDetail;

describe('runPdf', () => {
  it('turns each test into a row with its result, recovery time and repairs', () => {
    const report = runPdf(
      run(
        [
          item({
            experimentId: 'EXP1',
            startedAt: '2026-11-11T21:50:00.000Z',
            endedAt: '2026-11-11T21:55:00.000Z',
            healthyAt: '2026-11-11T21:57:30.000Z',
            repairs: [
              { at: '2026-11-11T21:56:00.000Z', text: 'Started game-proxy-1 again' },
              { at: null, text: "Couldn't start game-proxy-2 again; start it by hand" },
            ],
            report: { result: 'failed', reason: 'Stop condition triggered.' } as ExperimentRunItemState['report'],
          }),
          item({ templateId: 'EXT2', label: 'Valkey failover', skipped: "game-cache isn't available (modifying)" }),
          item({ templateId: 'EXT3', label: 'Zone outage', cancelled: true, note: 'Not run: the run stopped before it.' }),
        ],
        'Stopped: the environment was not healthy.',
      ),
    );
    expect(report.rows.map(({ result, reason, healthyAfterMs }) => [result, reason, healthyAfterMs])).toEqual([
      ['Failed', 'Stop condition triggered.', 150_000],
      ['Skipped', "game-cache isn't available (modifying)", null],
      ['Cancelled', 'Not run: the run stopped before it.', null],
    ]);
    expect(report.summary).toBe('3 tests · 0 completed · 1 skipped · 1 failed · 1 cancelled · 2 repairs');
    expect(report.notes).toEqual([
      'Stopped: the environment was not healthy.',
      "Couldn't start game-proxy-2 again; start it by hand",
    ]);
  });

  it('renders a PDF that starts with the PDF header', async () => {
    const pdf = await renderReportPdf(runPdf(run([item({})])), 'Asia/Tbilisi');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('PDF helpers', () => {
  it('falls back to UTC for an unknown timezone', () => {
    expect(safeTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(safeTimeZone('Mars/Base')).toBe('UTC');
    expect(safeTimeZone(undefined)).toBe('UTC');
  });

  it('names the file after the run and its day', () => {
    expect(pdfName('All tests', '2026-11-11T21:50:00.000Z')).toBe('failover-tests-all-tests-2026-11-11.pdf');
  });
});
