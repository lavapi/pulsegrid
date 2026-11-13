import { Field, Input } from '@/components/ui/input';

/** The authenticator code every change asks for again. A backup code works too. */
export function CodeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Code from your authenticator app">
      <Input
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
