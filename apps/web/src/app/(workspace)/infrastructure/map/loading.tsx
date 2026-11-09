import { CanvasSkeleton, HeaderSkeleton, PageLoading } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton back />
      <CanvasSkeleton />
    </PageLoading>
  );
}
