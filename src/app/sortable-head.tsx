import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { TableHead } from "@/components/ui/table";
import type { Sort } from "./sorted-groups.ts";

// The heading of a column a table sorts by, with an arrow for the direction
// while the table is sorted by it. Clicking it asks for the table's next sort.
// A `repeat` of the table's first heading, under a later group, shows the
// same text and arrow without the button or the sort state, so the table has
// one control and one sorted column per sortable column.
export function SortableHead<Column extends string>({
  column,
  sort,
  onSort,
  repeat,
  className,
  children,
}: {
  column: Column;
  sort: Sort<Column>;
  onSort: (column: Column) => void;
  repeat: boolean;
  className?: string;
  children: ReactNode;
}) {
  const direction = sort?.column === column ? sort.direction : undefined;
  const Arrow = direction === "ascending" ? ArrowUp : ArrowDown;
  const label = (
    <>
      {children}
      {direction !== undefined && <Arrow className="size-3.5" />}
    </>
  );
  if (repeat) {
    return (
      <TableHead className={className}>
        <span className="inline-flex items-center gap-1">{label}</span>
      </TableHead>
    );
  }
  return (
    <TableHead className={className} aria-sort={direction ?? "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-sm outline-none hover:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        onClick={() => onSort(column)}
      >
        {label}
      </button>
    </TableHead>
  );
}
