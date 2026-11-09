import { CardGridSkeleton, HeaderSkeleton, PageLoading } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton />
      <CardGridSkeleton count={3} height="h-56" />
    </PageLoading>
  );
}
