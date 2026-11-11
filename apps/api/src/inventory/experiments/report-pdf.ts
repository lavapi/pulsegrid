import type { Repair } from '@pulsegrid/shared';
import PDFDocument from 'pdfkit';

export interface PdfRow {
  label: string;
  startedAt: string | null;
  endedAt: string | null;
  /** The final state in a word or two, such as Completed or Skipped. */
  result: string;
  reason: string | null;
  /** Milliseconds from the test's end until the environment was healthy again. */
  healthyAfterMs: number | null;
  repairs: Repair[];
}

export interface PdfReport {
  title: string;
  name: string;
  environment: string | null;
  account: string;
  startedBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  result: string;
  summary: string;
  rows: PdfRow[];
  /** Anything that needs attention, such as why the run stopped or servers to start by hand. */
  notes: string[];
}

const PAGE = { size: 'A4', layout: 'landscape', margin: 36 } as const;
const FONT = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const BODY_SIZE = 8.5;
const PADDING = 4;
const RULE = 0.5;
const COLORS = { text: '#111827', muted: '#6b7280', rule: '#d1d5db', head: '#f3f4f6', zebra: '#fafafa' };

/** Column widths in points; they fill the 770 points between A4 landscape margins. */
const COLUMNS: { title: string; width: number }[] = [
  { title: '#', width: 20 },
  { title: 'Test', width: 168 },
  { title: 'Started', width: 72 },
  { title: 'Ended', width: 72 },
  { title: 'Duration', width: 54 },
  { title: 'Result and reason', width: 196 },
  { title: 'Healthy again after', width: 66 },
  { title: 'Repairs', width: 122 },
];

export const formatSpan = (ms: number | null): string => {
  if (ms === null || ms < 0) {
    return '—';
  }
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours} h ${minutes % 60} min`;
  }
  return minutes > 0 ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
};

const between = (from: string | null, to: string | null): number | null =>
  from && to ? Date.parse(to) - Date.parse(from) : null;

/** Times in the reader's timezone; dates appear only when they differ from the run's first day. */
const timeFormat = (timeZone: string) => {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return {
    full: (iso: string | null) => (iso ? `${day.format(new Date(iso))}, ${clock.format(new Date(iso))}` : '—'),
    clock: (iso: string | null, firstDay: string | null) => {
      if (!iso) {
        return '—';
      }
      const sameDay = firstDay && day.format(new Date(iso)) === day.format(new Date(firstDay));
      return sameDay ? clock.format(new Date(iso)) : `${day.format(new Date(iso))} ${clock.format(new Date(iso))}`;
    },
  };
};

const cells = (row: PdfRow, index: number, format: ReturnType<typeof timeFormat>, firstDay: string | null): string[] => [
  String(index + 1),
  row.label,
  format.clock(row.startedAt, firstDay),
  format.clock(row.endedAt, firstDay),
  formatSpan(between(row.startedAt, row.endedAt)),
  row.reason ? `${row.result}: ${row.reason}` : row.result,
  formatSpan(row.healthyAfterMs),
  row.repairs.length > 0
    ? row.repairs.map(({ at, text }) => (at ? `${text} at ${format.clock(at, firstDay)}` : text)).join('\n')
    : '—',
];

/**
 * A failover test report as a PDF: a header with the run's facts, then one table row per test. Rows wrap their text
 * to fit, never split across pages, and the table header repeats on every page.
 */
export const renderReportPdf = (report: PdfReport, timeZone: string): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: `${report.title}: ${report.name}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const format = timeFormat(timeZone);
    const left = doc.page.margins.left;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 14;
    const tableWidth = COLUMNS.reduce((sum, { width }) => sum + width, 0);

    doc.fillColor(COLORS.muted).font(FONT).fontSize(9).text(report.title.toUpperCase(), { characterSpacing: 0.5 });
    doc.fillColor(COLORS.text).font(BOLD).fontSize(18).text(report.name);
    doc.moveDown(0.3);
    const facts: [string, string][] = [
      ['Environment', report.environment ?? 'None'],
      ['Account', report.account],
      ['Started by', report.startedBy ?? 'Outside PulseGrid'],
      ['Started', format.full(report.startedAt)],
      ['Ended', format.full(report.endedAt)],
      ['Duration', formatSpan(between(report.startedAt, report.endedAt))],
      ['Result', report.result],
      ['Times in', timeZone],
    ];
    const factWidth = tableWidth / 4;
    const factTop = doc.y;
    facts.forEach(([label, value], index) => {
      const x = left + (index % 4) * factWidth;
      const y = factTop + Math.floor(index / 4) * 26;
      doc.fillColor(COLORS.muted).font(FONT).fontSize(7.5).text(label, x, y, { width: factWidth - 8 });
      doc.fillColor(COLORS.text).font(BOLD).fontSize(9).text(value, x, y + 10, { width: factWidth - 8, lineBreak: false, ellipsis: true });
    });
    doc.y = factTop + 58;
    doc.x = left;
    doc.fillColor(COLORS.text).font(FONT).fontSize(9).text(report.summary, left, doc.y, { width: tableWidth });
    doc.moveDown(0.6);

    const rowHeight = (values: string[], font: string) => {
      doc.font(font).fontSize(BODY_SIZE);
      return (
        Math.max(...values.map((value, index) => doc.heightOfString(value, { width: (COLUMNS[index]?.width ?? 0) - PADDING * 2 }))) +
        PADDING * 2
      );
    };
    const drawRow = (values: string[], font: string, fill: string | null) => {
      const height = rowHeight(values, font);
      const top = doc.y;
      if (fill) {
        doc.rect(left, top + RULE, tableWidth, height - RULE).fill(fill);
      }
      let x = left;
      values.forEach((value, index) => {
        const width = COLUMNS[index]?.width ?? 0;
        doc.fillColor(COLORS.text).font(font).fontSize(BODY_SIZE).text(value, x + PADDING, top + PADDING, { width: width - PADDING * 2 });
        x += width;
      });
      doc.moveTo(left, top + height).lineTo(left + tableWidth, top + height).lineWidth(RULE).strokeColor(COLORS.rule).stroke();
      doc.y = top + height;
      doc.x = left;
    };
    const header = COLUMNS.map(({ title }) => title);
    const drawHeader = () => drawRow(header, BOLD, COLORS.head);

    drawHeader();
    const firstDay = report.startedAt;
    report.rows.forEach((row, index) => {
      const values = cells(row, index, format, firstDay);
      if (doc.y + rowHeight(values, FONT) > bottom()) {
        doc.addPage();
        drawHeader();
      }
      drawRow(values, FONT, index % 2 === 1 ? COLORS.zebra : null);
    });

    if (report.notes.length > 0) {
      const notesHeight = report.notes.reduce((sum, note) => sum + doc.heightOfString(note, { width: tableWidth }) + 4, 24);
      if (doc.y + notesHeight > bottom()) {
        doc.addPage();
      }
      doc.moveDown(1);
      doc.fillColor(COLORS.text).font(BOLD).fontSize(10).text('Needs attention', left, doc.y, { width: tableWidth });
      doc.moveDown(0.3);
      report.notes.forEach((note) => {
        doc.fillColor(COLORS.text).font(FONT).fontSize(9).text(`• ${note}`, left, doc.y, { width: tableWidth });
        doc.moveDown(0.2);
      });
    }

    const pages = doc.bufferedPageRange();
    for (let page = 0; page < pages.count; page += 1) {
      doc.switchToPage(page);
      const y = doc.page.height - doc.page.margins.bottom + 8;
      doc.page.margins.bottom = 0;
      doc.fillColor(COLORS.muted).font(FONT).fontSize(7.5);
      doc.text(`${report.title} · ${report.name}`, left, y, { width: tableWidth / 2, lineBreak: false });
      doc.text(`Page ${page + 1} of ${pages.count}`, left + tableWidth / 2, y, { width: tableWidth / 2, align: 'right', lineBreak: false });
    }
    doc.end();
  });
