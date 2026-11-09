"use client";

import { ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AssignedPRGroup, AssignedPRRow, ReviewerRow, ReviewRow, ReviewStatus } from "../stunt/page-model.ts";
import { Badge } from "./badge.tsx";
import { FeatureGroups } from "./feature-groups.tsx";
import { SortableHead } from "./sortable-head.tsx";
import { type AssignedPRColumn, nextSort, type Sort, sortedAssignedPRs } from "./sorted-groups.ts";

const STATE_STYLES: Record<ReviewStatus | ReviewRow["state"] | ReviewerRow["state"], string> = {
  "review required": "border-border text-muted-foreground",
  approved: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  "changes requested": "border-destructive/30 bg-destructive/10 text-destructive",
  commented: "border-border text-muted-foreground",
  dismissed: "border-border text-muted-foreground line-through",
  pending: "border-dashed border-border text-muted-foreground",
};

const PENDING_REVIEW_STYLE = "border-amber-600/30 bg-amber-600/10 text-amber-700 dark:text-amber-400";

// A repository's Assigned PRs, under their Feature headings, sorted within
// them by PR or Updated when that heading is clicked. A row shows Pending
// review, or else where each reviewer stands. Opening a row shows each
// reviewer's latest review and who a review is still requested from.
export function AssignedPRTable({ groups }: { groups: AssignedPRGroup[] }) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [sort, setSort] = useState<Sort<AssignedPRColumn>>(null);
  const sortBy = (column: AssignedPRColumn) => setSort((current) => nextSort(current, column));

  const toggle = (number: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(number)) next.add(number);
      return next;
    });
  };

  return (
    <FeatureGroups
      groups={sortedAssignedPRs(groups, sort)}
      columns={7}
      header={
        <TableRow>
          <TableHead className="w-8" />
          <SortableHead column="pr" sort={sort} onSort={sortBy} className="w-20">
            PR
          </SortableHead>
          <TableHead>Title</TableHead>
          <TableHead>Author</TableHead>
          <TableHead>Review status</TableHead>
          <TableHead>Reviewers</TableHead>
          <SortableHead column="updated" sort={sort} onSort={sortBy} className="text-right">
            Updated
          </SortableHead>
        </TableRow>
      }
      rows={(prs) =>
        prs.map((pr) => {
          const expanded = open.has(pr.number);
          return (
            <Fragment key={pr.number}>
              <TableRow className="cursor-pointer" onClick={() => toggle(pr.number)}>
                <TableCell className="pr-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Close" : "Open"} reviews of #${pr.number}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggle(pr.number);
                    }}
                  >
                    <ChevronRight className={cn("transition-transform", expanded && "rotate-90")} />
                  </Button>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">#{pr.number}</TableCell>
                <TableCell className="max-w-0 w-full">
                  <div className="flex items-center gap-2">
                    <a
                      href={pr.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-medium hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {pr.title}
                    </a>
                    {pr.draft && <Badge className="border-border text-muted-foreground">draft</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{pr.author}</TableCell>
                <TableCell>
                  <Badge className={STATE_STYLES[pr.reviewStatus]}>{pr.reviewStatus}</Badge>
                </TableCell>
                <TableCell>
                  <Reviewers pr={pr} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{pr.updatedAgo}</TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="hover:bg-transparent">
                  <TableCell />
                  <TableCell colSpan={6} className="whitespace-normal">
                    <ReviewDetail pr={pr} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })
      }
    />
  );
}

function Reviewers({ pr }: { pr: AssignedPRRow }) {
  if (pr.pendingReview) return <Badge className={PENDING_REVIEW_STYLE}>pending review</Badge>;
  return (
    <div className="flex flex-wrap gap-1">
      {pr.reviewers.map(({ reviewer, state }) => (
        <Badge key={reviewer} className={STATE_STYLES[state]}>{`${reviewer} ${state}`}</Badge>
      ))}
    </div>
  );
}

function ReviewDetail({ pr }: { pr: AssignedPRRow }) {
  return (
    <div className="grid gap-4 py-1 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reviews</h3>
        {pr.reviews.length === 0 ? (
          <p className="text-muted-foreground">No reviews yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pr.reviews.map((review) => (
              <li key={review.reviewer} className="flex items-center gap-2">
                <span className="font-medium">{review.reviewer}</span>
                <Badge className={STATE_STYLES[review.state]}>{review.state}</Badge>
                <span className="ml-auto text-muted-foreground">{review.submittedAgo}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Waiting on</h3>
        {pr.pendingReviewers.length === 0 ? (
          <p className="text-muted-foreground">No one else requested.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pr.pendingReviewers.map((reviewer) => (
              <li key={reviewer} className="font-medium">
                {reviewer}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
