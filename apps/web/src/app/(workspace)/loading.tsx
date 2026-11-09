import { CardGridSkeleton, HeaderSkeleton, PageLoading, TilesSkeleton } from '@/components/skeletons';

export default function WorkspaceLoading() {
  return (
    <PageLoading>
      <HeaderSkeleton />
      <TilesSkeleton />
      <CardGridSkeleton />
    </PageLoading>
  );
}
