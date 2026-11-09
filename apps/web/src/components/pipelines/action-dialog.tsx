'use client';

import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ActionDialogProps {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  danger?: boolean;
  blockedReason?: string | null;
  canConfirm?: boolean;
  wide?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
  onConfirm: () => void;
}

export function ActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pending,
  danger = false,
  blockedReason = null,
  canConfirm = true,
  wide = false,
  onOpenChange,
  children,
  onConfirm,
}: ActionDialogProps) {
  const [open, setOpen] = useState(false);
  const confirmed = canConfirm && !blockedReason;

  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (confirmed) {
      onConfirm();
      change(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? 'max-h-[90vh] max-w-3xl overflow-y-auto' : undefined}>
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        <form className="mt-4 flex flex-col gap-4" onSubmit={submit}>
          {children}
          {blockedReason && (
            <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning" role="status">
              {blockedReason}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button variant={danger ? 'danger' : 'primary'} disabled={!confirmed || pending}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
