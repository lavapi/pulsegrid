'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './button';

const RESET_MS = 1500;

/** Copies the value. With `showLabel`, the label is shown beside the icon instead of only read out. */
export function CopyButton({ value, label, showLabel = false }: { value: string; label: string; showLabel?: boolean }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), RESET_MS);
    } catch {
      toast.error('Your browser blocked copying. Select the text and copy it yourself.');
    }
  };

  const icon = copied ? <Check className="text-success" /> : <Copy />;
  return showLabel ? (
    <Button size="sm" onClick={copy}>
      {icon}
      {copied ? 'Copied' : label}
    </Button>
  ) : (
    <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={label} onClick={copy}>
      {icon}
    </Button>
  );
}
