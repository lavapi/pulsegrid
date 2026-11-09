import { HeaderSkeleton, PageLoading, TableSkeleton } from '@/components/skeletons';

export default function Loading() {
  return (
    <PageLoading>
      <HeaderSkeleton back />
      <TableSkeleton rows={8} />
    </PageLoading>
  );
}
