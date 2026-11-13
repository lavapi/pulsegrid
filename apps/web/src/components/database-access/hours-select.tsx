import { Field } from '@/components/ui/input';

export function HoursSelect({
  label,
  value,
  maxHours,
  onChange,
}: {
  label: string;
  value: number;
  maxHours: number;
  onChange: (hours: number) => void;
}) {
  return (
    <Field label={label}>
      <select
        className="h-9 rounded-lg border bg-card px-2 text-sm"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {Array.from({ length: maxHours }, (_, index) => index + 1).map((hours) => (
          <option key={hours} value={hours}>
            {hours} {hours === 1 ? 'hour' : 'hours'}
          </option>
        ))}
      </select>
    </Field>
  );
}
