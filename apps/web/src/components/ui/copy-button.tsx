'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from './button';

const RESET_MS = 1500;

export function CopyButton({ value, label }: { value: string; label: string }) {
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

  return (
    <Button variant="ghost" size="sm" className="size-7 p-0" aria-label={label} onClick={copy}>
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  );
}
