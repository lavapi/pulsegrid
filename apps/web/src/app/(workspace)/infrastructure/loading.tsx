import { CardGridSkeleton, HeaderSkeleton, PageLoading, TilesSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton />
      <TilesSkeleton />
      <CardGridSkeleton />
    </PageLoading>
  );
}
