import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type Table as TableInstance,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  Check,
  PlusCircle,
  Settings2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, LoadingRows, SearchToolbar } from '@/components/shared'
import { cn } from '@/lib/utils'

export type { ColumnDef } from '@tanstack/react-table'

/** Sortable header cell. Columns opt in by using this as their `header`. */
export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: import('@tanstack/react-table').Column<TData, TValue>
  title: string
  className?: string
}) {
  if (!column.getCanSort()) return <span className={className}>{title}</span>

  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8 data-[state=open]:bg-accent', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {title}
      {sorted === 'asc' ? <ArrowUp /> : sorted === 'desc' ? <ArrowDown /> : <ChevronsUpDown className="opacity-50" />}
    </Button>
  )
}

export interface FacetOption {
  label: string
  value: string
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: {
  column?: import('@tanstack/react-table').Column<TData, TValue>
  title: string
  options: FacetOption[]
}) {
  const facets = column?.getFacetedUniqueValues()
  const selected = new Set(column?.getFilterValue() as string[] | undefined)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          <PlusCircle />
          {title}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 data-[orientation=vertical]:h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {selected.size}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = selected.has(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    onSelect={() => {
                      if (isSelected) selected.delete(option.value)
                      else selected.add(option.value)
                      const values = Array.from(selected)
                      column?.setFilterValue(values.length ? values : undefined)
                    }}
                  >
                    <span
                      className={cn(
                        'flex size-4 items-center justify-center rounded-[4px] border',
                        isSelected ? 'bg-primary text-primary-foreground border-primary' : 'opacity-50',
                      )}
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                    <span className="truncate">{option.label}</span>
                    {facets?.get(option.value) !== undefined && (
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {facets.get(option.value)}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem className="justify-center" onSelect={() => column?.setFilterValue(undefined)}>
                    Clear filters
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function DataTableViewOptions<TData>({ table }: { table: TableInstance<TData> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="ml-auto hidden lg:flex">
          <Settings2 />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {table
          .getAllColumns()
          .filter((column) => column.getCanHide())
          .map((column) => (
            <DropdownMenuCheckboxItem
              key={column.id}
              className="capitalize"
              checked={column.getIsVisible()}
              onCheckedChange={(value) => column.toggleVisibility(Boolean(value))}
            >
              {typeof column.columnDef.meta === 'object' && column.columnDef.meta && 'label' in column.columnDef.meta
                ? String((column.columnDef.meta as { label?: string }).label)
                : column.id}
            </DropdownMenuCheckboxItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DataTablePagination<TData>({ table }: { table: TableInstance<TData> }) {
  const { pageIndex, pageSize } = table.getState().pagination
  const total = table.getFilteredRowModel().rows.length
  const first = total === 0 ? 0 : pageIndex * pageSize + 1
  const last = Math.min(total, (pageIndex + 1) * pageSize)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
      </p>
      <div className="flex items-center gap-4">
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-sm text-muted-foreground">Rows</span>
          <Select value={String(pageSize)} onValueChange={(value) => table.setPageSize(Number(value))}>
            <SelectTrigger size="sm" className="w-[4.5rem]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 30, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-sm text-muted-foreground">
          Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            aria-label="First page"
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden size-8 lg:flex"
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            aria-label="Last page"
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  )
}

export interface DataTableFacet {
  columnId: string
  title: string
  options: FacetOption[]
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading,
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  facets,
  toolbar,
  onRowClick,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  pageSize = 20,
  initialVisibility,
}: {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  /** Provided by the page when search must stay server-side (messages, tasks). */
  search?: string
  onSearch?: (value: string) => void
  searchPlaceholder?: string
  facets?: DataTableFacet[]
  toolbar?: React.ReactNode
  onRowClick?: (row: TData) => void
  emptyTitle?: string
  emptyDescription?: string
  pageSize?: number
  initialVisibility?: VisibilityState
}) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>(initialVisibility ?? {})

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
  })

  const filtered = columnFilters.length > 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {onSearch && (
          <div className="min-w-56 flex-1">
            <SearchToolbar search={search ?? ''} onSearch={onSearch} placeholder={searchPlaceholder} />
          </div>
        )}
        {facets?.map((facet) => (
          <DataTableFacetedFilter
            key={facet.columnId}
            column={table.getColumn(facet.columnId)}
            title={facet.title}
            options={facet.options}
          />
        ))}
        {filtered && (
          <Button variant="ghost" size="sm" onClick={() => setColumnFilters([])}>
            Reset
            <X />
          </Button>
        )}
        {toolbar}
        <DataTableViewOptions table={table} />
      </div>

      {loading ? (
        <LoadingRows columns={Math.max(2, table.getVisibleFlatColumns().length)} />
      ) : data.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <TableHead key={header.id} style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}>
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </TableHead>
                      ))}
                    </TableRow>
                  ))}
                </TableHeader>
                <TableBody>
                  {table.getRowModel().rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={table.getVisibleFlatColumns().length} className="h-24 text-center text-muted-foreground">
                        No rows match these filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    table.getRowModel().rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={onRowClick ? 'cursor-pointer' : undefined}
                        tabIndex={onRowClick ? 0 : undefined}
                        onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                        onKeyDown={onRowClick
                          ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                onRowClick(row.original)
                              }
                            }
                          : undefined}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <DataTablePagination table={table} />
        </>
      )}
    </div>
  )
}
