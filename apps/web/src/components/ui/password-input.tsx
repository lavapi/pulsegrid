'use client';

import { Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  validationMessage?: string;
};

export function PasswordInput({ className, validationMessage = '', ...props }: PasswordInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;

  useEffect(() => {
    input.current?.setCustomValidity(validationMessage);
  }, [validationMessage]);

  useEffect(() => {
    const form = input.current?.form;
    const hide = () => setVisible(false);
    form?.addEventListener('submit', hide);
    return () => form?.removeEventListener('submit', hide);
  }, []);

  return (
    <div className="relative">
      <Input ref={input} type={visible ? 'text' : 'password'} className={cn('pr-9', className)} {...props} />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
        onClick={() => setVisible(!visible)}
      >
        <Icon className="size-4" aria-hidden />
      </button>
    </div>
  );
}
