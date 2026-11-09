'use client';

import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-lg place-items-center p-4">
      <EmptyState
        icon={TriangleAlert}
        title="This page didn't load"
        description="Something went wrong on our side. Try again in a moment."
        action={
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
