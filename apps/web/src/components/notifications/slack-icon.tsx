import { MessageSquareText } from 'lucide-react';

export function SlackIcon({ size = 44 }: { size?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded bg-muted text-muted-foreground"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <MessageSquareText className="size-1/2" />
    </span>
  );
}
