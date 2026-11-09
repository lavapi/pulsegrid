import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const repeat = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

export function PageLoading({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      {children}
    </div>
  );
}

export function HeaderSkeleton({ back = false }: { back?: boolean }) {
  return (
    <>
      {back && <Skeleton className="h-4 w-28" />}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
    </>
  );
}

export function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3', count > 2 && 'lg:grid-cols-4')}>
      {repeat(count).map((tile) => (
        <Skeleton className="h-[78px] rounded-xl" key={tile} />
      ))}
    </div>
  );
}

export function CardGridSkeleton({ count = 6, height = 'h-44' }: { count?: number; height?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3.5 md:grid-cols-2 xl:grid-cols-3">
      {repeat(count).map((card) => (
        <Skeleton className={cn(height, 'rounded-xl')} key={card} />
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <Card>
      <div className="border-b px-5 py-4">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="divide-y">
        {repeat(rows).map((row) => (
          <div className="flex items-center gap-4 px-5 py-3.5" key={row}>
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="hidden h-4 w-24 sm:block" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function DetailsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <div className="border-b px-5 py-4">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="divide-y">
        {repeat(rows).map((row) => (
          <div className="grid gap-2 px-5 py-3 sm:grid-cols-[200px_minmax(0,1fr)]" key={row}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CanvasSkeleton() {
  return <Skeleton className="h-[calc(100dvh-240px)] min-h-[520px] rounded-xl" />;
}
