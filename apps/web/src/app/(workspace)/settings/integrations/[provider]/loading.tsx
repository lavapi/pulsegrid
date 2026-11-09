import { DetailsSkeleton, HeaderSkeleton, PageLoading } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton back />
      <DetailsSkeleton rows={3} />
      <DetailsSkeleton />
    </PageLoading>
  );
}
