"use client";

import { useState } from "react";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import type { ReviewInboxGroup } from "../stunt/page-model.ts";
import { Badge } from "./badge.tsx";
import { FeatureGroups } from "./feature-groups.tsx";
import { SortableHead } from "./sortable-head.tsx";
import { nextSort, type ReviewInboxColumn, type Sort, sortedReviewInbox } from "./sorted-groups.ts";

// A repository's Review inbox, under its Feature headings, sorted within them
// by PR or Requested when that heading is clicked.
export function ReviewInboxTable({ groups }: { groups: ReviewInboxGroup[] }) {
  const [sort, setSort] = useState<Sort<ReviewInboxColumn>>(null);
  const sortBy = (column: ReviewInboxColumn) => setSort((current) => nextSort(current, column));

  return (
    <FeatureGroups
      groups={sortedReviewInbox(groups, sort)}
      columns={5}
      header={(repeat) => (
        <TableRow>
          <SortableHead column="pr" sort={sort} onSort={sortBy} repeat={repeat} className="w-20">
            PR
          </SortableHead>
          <TableHead>Title</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Requested by</TableHead>
          <SortableHead column="requested" sort={sort} onSort={sortBy} repeat={repeat} className="text-right">
            Requested
          </SortableHead>
        </TableRow>
      )}
      rows={(prs) =>
        prs.map((pr) => (
          <TableRow key={pr.number}>
            <TableCell className="text-muted-foreground tabular-nums">#{pr.number}</TableCell>
            <TableCell className="max-w-0 w-full">
              <div className="flex items-center gap-2">
                <a href={pr.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
                  {pr.title}
                </a>
                {pr.reRequest && (
                  <Badge className="border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400">
                    re-request
                  </Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="text-muted-foreground">{pr.author}</TableCell>
            <TableCell className="text-muted-foreground">{pr.request?.by ?? "unknown"}</TableCell>
            <TableCell className="text-right text-muted-foreground">{pr.request?.ago ?? "unknown"}</TableCell>
          </TableRow>
        ))
      }
    />
  );
}
