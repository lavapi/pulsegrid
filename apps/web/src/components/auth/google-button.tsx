import { Button } from '@/components/ui/button';

export function GoogleButton() {
  return (
    <Button asChild className="w-full">
      <a href="/api/auth/google">Continue with Google</a>
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
