import { HeaderSkeleton, PageLoading, TableSkeleton, TilesSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton back />
      <TilesSkeleton />
      <TableSkeleton />
    </PageLoading>
  );
}
