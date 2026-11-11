'use client';

import { FileDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiDownload, apiSend } from '@/lib/browser-api';
import { HISTORY_PATH } from '@/lib/experiments';
import { useTimeMode } from '@/lib/time-mode';

/** Downloads the report as a PDF table, with times in the zone the reader has chosen. */
export function DownloadPdfButton({ path, fileName }: { path: string; fileName: string }) {
  const mode = useTimeMode();
  const [pending, startTransition] = useTransition();
  const download = () =>
    startTransition(async () => {
      const timeZone = mode === 'utc' ? 'UTC' : Intl.DateTimeFormat().resolvedOptions().timeZone;
      const separator = path.includes('?') ? '&' : '?';
      const failure = await apiDownload(`${path}${separator}timeZone=${encodeURIComponent(timeZone)}`, fileName);
      if (failure) {
        toast.error(failure);
      }
    });
  return (
    <Button size="sm" disabled={pending} onClick={download}>
      <FileDown aria-hidden="true" />
      Download PDF
    </Button>
  );
}

export function ExportHistoryButton({ query }: { query: string }) {
  const [pending, startTransition] = useTransition();
  const download = () =>
    startTransition(async () => {
      const failure = await apiDownload(`/experiment-reports/export${query}`, 'failover-tests.csv');
      if (failure) {
        toast.error(failure);
      }
    });
  return (
    <Button size="sm" disabled={pending} onClick={download}>
      <FileDown aria-hidden="true" />
      Export CSV
    </Button>
  );
}

export function DeleteReportButton({ path, label }: { path: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const remove = () =>
    startTransition(async () => {
      const failure = await apiSend(path, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Report deleted');
      router.push(HISTORY_PATH);
    });
  return (
    <span className="print:hidden">
      <ConfirmButton
        label="Delete report"
        title={`Delete the report for ${label}?`}
        description="The report is removed from history for everyone. Nothing changes in AWS."
        confirmLabel="Delete report"
        disabled={pending}
        onConfirm={remove}
      />
    </span>
  );
}
