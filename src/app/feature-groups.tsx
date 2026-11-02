import type { ReactNode } from "react";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { FeatureGroup } from "../stunt/page-model.ts";

// PRs in one table, under a heading per Feature, or Unfiled, so their
// columns line up across groups. Each group repeats `header`, the row of
// column headings, `columns` wide, and shows its PRs as `rows`. Two Features
// may share a name, so a repeated name is keyed by how many times it has
// come up.
export function FeatureGroups<Row>({
  groups,
  columns,
  header,
  rows,
}: {
  groups: FeatureGroup<Row>[];
  columns: number;
  header: ReactNode;
  rows: (prs: Row[]) => ReactNode;
}) {
  const seen = new Map<string, number>();
  return (
    <Table>
      {groups.map((group, index) => {
        const name = group.feature ?? "Unfiled";
        const count = (seen.get(name) ?? 0) + 1;
        seen.set(name, count);
        return (
          <TableBody key={JSON.stringify([name, count])}>
            <TableRow className="border-0 hover:bg-transparent">
              <TableCell
                colSpan={columns}
                className={cn("px-0 pb-1 text-sm font-medium text-muted-foreground", index > 0 && "pt-6")}
              >
                {name}
              </TableCell>
            </TableRow>
            {header}
            {rows(group.prs)}
          </TableBody>
        );
      })}
    </Table>
  );
}
