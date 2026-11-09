'use client';

import type { TemporaryPassword } from '@pulsegrid/shared';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Time } from '@/components/ui/time';

interface TemporaryPasswordDialogProps {
  created: TemporaryPassword | null;
  memberName: string;
  onClose: () => void;
}

export function TemporaryPasswordDialog({ created, memberName, onClose }: TemporaryPasswordDialogProps) {
  return (
    <Dialog open={created !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">Temporary password</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          Send this to {memberName} privately. It won't be shown again, and it expires on{' '}
          {created && <Time value={created.expiresAt} withZone />}.
        </DialogDescription>
        <div className="mt-4 flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <code className="min-w-0 flex-1 break-all text-[13px]">{created?.password}</code>
          <CopyButton value={created?.password ?? ''} label="Copy temporary password" />
        </div>
        <div className="mt-5 flex justify-end">
          <DialogClose asChild>
            <Button variant="primary">Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
