import { DetailsSkeleton, HeaderSkeleton, PageLoading } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton back />
      <DetailsSkeleton />
      <DetailsSkeleton rows={4} />
    </PageLoading>
  );
}
