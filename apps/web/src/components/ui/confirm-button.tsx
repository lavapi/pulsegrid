'use client';

import { useState } from 'react';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';

interface ConfirmButtonProps {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}

export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  disabled,
  onConfirm,
}: ConfirmButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="dangerGhost" size="sm" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
