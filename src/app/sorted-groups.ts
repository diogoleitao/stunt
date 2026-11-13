import type {
  AssignedPRGroup,
  AssignedPRRow,
  FeatureGroup,
  ReviewInboxGroup,
  ReviewInboxRow,
} from "../stunt/page-model.ts";
import { requestTime } from "../stunt/request-time.ts";

// A table's sort by one of its sortable columns, or null for the default
// order.
export type Sort<Column extends string> = { column: Column; direction: "descending" | "ascending" } | null;

// The sort after clicking `column`'s header: descending, then ascending, then
// the default order. Another column starts at descending.
export function nextSort<Column extends string>(sort: Sort<Column>, column: Column): Sort<Column> {
  if (sort?.column !== column) return { column, direction: "descending" };
  return sort.direction === "descending" ? { column, direction: "ascending" } : null;
}

export type AssignedPRColumn = "pr" | "updated";

export type ReviewInboxColumn = "pr" | "requested";

// `groups` with each group's PRs ordered by `sort`, by the number `keys`
// give the sorted column, ties in the default order. The groups keep their
// order.
function sortedGroups<Row, Column extends string>(
  groups: FeatureGroup<Row>[],
  sort: Sort<Column>,
  keys: Record<Column, (row: Row) => number>,
): FeatureGroup<Row>[] {
  if (sort === null) return groups;
  const key = keys[sort.column];
  const sign = sort.direction === "descending" ? -1 : 1;
  // Infinity minus Infinity is NaN, which sorting takes as a tie.
  return groups.map((group) => ({ ...group, prs: group.prs.toSorted((a, b) => sign * (key(a) - key(b))) }));
}

// A repository's Assigned PRs ordered by `sort` within their groups.
export function sortedAssignedPRs(groups: AssignedPRGroup[], sort: Sort<AssignedPRColumn>): AssignedPRGroup[] {
  return sortedGroups(groups, sort, {
    pr: (row: AssignedPRRow) => row.number,
    updated: (row: AssignedPRRow) => Date.parse(row.updatedAt),
  });
}

// A repository's Review inbox ordered by `sort` within its groups, Requested
// in `requestTime` order, as the default order is.
export function sortedReviewInbox(groups: ReviewInboxGroup[], sort: Sort<ReviewInboxColumn>): ReviewInboxGroup[] {
  return sortedGroups(groups, sort, {
    pr: (row: ReviewInboxRow) => row.number,
    requested: requestTime,
  });
}
