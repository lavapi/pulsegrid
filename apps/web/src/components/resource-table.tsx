'use client';

import { type Resource, type ResourceType, resourcePath } from '@pulsegrid/shared';
import {
  type CellContext,
  type ColumnDef,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { HealthBadge } from '@/components/health-badge';
import { Input } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { RESOURCE_COLUMNS, TYPE_COLUMN } from '@/lib/service-views';

const SEARCH_THRESHOLD = 8;
const SORTER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

interface ResourceTableProps {
  resources: Resource[];
  columnSet?: ResourceType | 'summary';
  showAccount?: boolean;
}

const textColumn = (
  header: string,
  value: (resource: Resource) => string,
): ColumnDef<Resource> => ({
  id: header,
  header,
  accessorFn: value,
  sortingFn: (first, second, id) =>
    SORTER.compare(String(first.getValue(id)), String(second.getValue(id))),
});

const timeCell = (value: string | null | undefined) => (value ? <Time value={value} /> : '—');

const buildColumns = (
  columnSet: ResourceTableProps['columnSet'],
  showAccount: boolean,
): ColumnDef<Resource>[] => {
  const extra = columnSet === 'summary' || !columnSet ? [TYPE_COLUMN] : RESOURCE_COLUMNS[columnSet];
  return [
    {
      ...textColumn('Name', ({ name }) => name),
      cell: ({ row }) => (
        <Link
          href={resourcePath(row.original)}
          className="font-medium text-foreground hover:text-primary"
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      ...textColumn('Status', ({ status }) => status),
      cell: ({ row }) => (
        <HealthBadge health={row.original.health} status={row.original.status} />
      ),
    },
    ...extra.map(({ label, value, timeOf }) => ({
      ...textColumn(label, value),
      ...(timeOf ? { cell: ({ row }: CellContext<Resource, unknown>) => timeCell(timeOf(row.original)) } : {}),
    })),
    textColumn('Region', ({ region }) => region),
    ...(showAccount ? [textColumn('Account', ({ cloudAccount }) => cloudAccount.name)] : []),
  ];
};

export function ResourceTable({
  resources,
  columnSet,
  showAccount = false,
}: ResourceTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState('');
  const columns = useMemo(() => buildColumns(columnSet, showAccount), [columnSet, showAccount]);

  const table = useReactTable({
    data: resources,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <>
      {resources.length >= SEARCH_THRESHOLD && (
        <div className="relative border-b p-3">
          <Search
            className="absolute left-6 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter this list"
            aria-label="Filter this list"
            className="max-w-xs pl-9"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr className="border-b" key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const Icon = sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown;
                  return (
                    <th
                      className="whitespace-nowrap px-4 py-2.5 text-left font-medium text-muted-foreground"
                      key={header.id}
                      aria-sort={
                        sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'
                      }
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {String(header.column.columnDef.header)}
                        <Icon className="size-3 text-faint" aria-hidden="true" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-b transition-colors last:border-0 hover:bg-muted/60" key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const render = cell.column.columnDef.cell;
                  return (
                    <td className="max-w-[320px] truncate whitespace-nowrap px-4 py-2.5" key={cell.id}>
                      {typeof render === 'function'
                        ? render(cell.getContext())
                        : String(cell.getValue())}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Nothing matches this filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
