import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFoundPage() {
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-lg place-items-center p-4">
      <EmptyState
        icon={SearchX}
        title="We can't find that page"
        description="It may have moved, or you may not have access to it."
        action={
          <Button asChild variant="primary">
            <Link href="/">Go to Overview</Link>
          </Button>
        }
      />
    </main>
  );
}
