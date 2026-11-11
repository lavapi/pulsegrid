'use client';

import { type ComponentProps, useState } from 'react';
import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from './dialog';
import { Field, Input } from './input';
import { ProductionNotice, useProductionTarget } from './production-notice';

interface ConfirmButtonProps {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  disabled?: boolean;
  /** When set, the person has to type this before confirming. */
  typeToConfirm?: string;
  triggerVariant?: ComponentProps<typeof Button>['variant'];
  /** Warn when this changes production: true for the selected account, or the name of what's production. */
  warnProduction?: boolean | string;
  onConfirm: () => void;
}

export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  disabled,
  typeToConfirm,
  triggerVariant = 'dangerGhost',
  warnProduction,
  onConfirm,
}: ConfirmButtonProps) {
  const production = useProductionTarget(warnProduction);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmed = !typeToConfirm || typed.trim() === typeToConfirm;

  const changeOpen = (next: boolean) => {
    setOpen(next);
    setTyped('');
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm" disabled={disabled}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {description}
        </DialogDescription>
        <div className="mt-4 empty:hidden">
          <ProductionNotice target={production} />
        </div>
        {typeToConfirm && (
          <Field label={`Type ${typeToConfirm} to confirm`} className="mt-4">
            <Input value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
          </Field>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={!confirmed}
            onClick={() => {
              changeOpen(false);
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
