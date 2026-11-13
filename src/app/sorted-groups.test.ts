import { describe, expect, it } from "vitest";
import type { AssignedPRGroup, AssignedPRRow, ReviewInboxGroup, ReviewInboxRow } from "../stunt/page-model.ts";
import { nextSort, sortedAssignedPRs, sortedReviewInbox } from "./sorted-groups.ts";

// An Assigned PR row; only its number and when it was updated matter here.
function assigned(number: number, updatedAt: string): AssignedPRRow {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/owner/repo/pull/${number}`,
    author: "user-1",
    draft: false,
    reviewStatus: "review required",
    pendingReview: false,
    reviewers: [],
    updatedAgo: "",
    updatedAt,
    reviews: [],
    pendingReviewers: [],
  };
}

// The PR numbers of each group, under its Feature.
function numbers(groups: { feature: string | null; prs: { number: number }[] }[]) {
  return groups.map(({ feature, prs }) => [feature, prs.map((pr) => pr.number)]);
}

// Unfiled, then Feature A in Ticket order, as the page model gives them.
const ASSIGNED: AssignedPRGroup[] = [
  {
    feature: null,
    prs: [assigned(3, "2026-11-03T00:00:00Z"), assigned(9, "2026-11-01T00:00:00Z"), assigned(5, "2026-10-30T00:00:00Z")],
  },
  { feature: "Feature A", prs: [assigned(2, "2026-10-29T00:00:00Z"), assigned(7, "2026-11-02T00:00:00Z")] },
];

describe("Assigned PRs sorted by column", () => {
  it("are in the default order with no sort", () => {
    expect(sortedAssignedPRs(ASSIGNED, null)).toEqual(ASSIGNED);
  });

  it("by PR, order each group's PRs by number, groups in place", () => {
    expect(numbers(sortedAssignedPRs(ASSIGNED, { column: "pr", direction: "descending" }))).toEqual([
      [null, [9, 5, 3]],
      ["Feature A", [7, 2]],
    ]);
    expect(numbers(sortedAssignedPRs(ASSIGNED, { column: "pr", direction: "ascending" }))).toEqual([
      [null, [3, 5, 9]],
      ["Feature A", [2, 7]],
    ]);
  });

  it("by Updated, order each group's PRs most recently updated first, or last, groups in place", () => {
    expect(numbers(sortedAssignedPRs(ASSIGNED, { column: "updated", direction: "descending" }))).toEqual([
      [null, [3, 9, 5]],
      ["Feature A", [7, 2]],
    ]);
    expect(numbers(sortedAssignedPRs(ASSIGNED, { column: "updated", direction: "ascending" }))).toEqual([
      [null, [5, 9, 3]],
      ["Feature A", [2, 7]],
    ]);
  });

  it("by Updated, keep PRs updated at the same time in the default order", () => {
    const tied: AssignedPRGroup[] = [
      {
        feature: "Feature A",
        prs: [assigned(4, "2026-11-01T00:00:00Z"), assigned(8, "2026-11-02T00:00:00Z"), assigned(6, "2026-11-01T00:00:00Z")],
      },
    ];

    expect(numbers(sortedAssignedPRs(tied, { column: "updated", direction: "descending" }))).toEqual([
      ["Feature A", [8, 4, 6]],
    ]);
    expect(numbers(sortedAssignedPRs(tied, { column: "updated", direction: "ascending" }))).toEqual([
      ["Feature A", [4, 6, 8]],
    ]);
  });
});

// A Review inbox row; only its number and since when its request has waited
// matter here, null for a request too old to have been read.
function inbox(number: number, waitingSince: string | null): ReviewInboxRow {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/owner/repo/pull/${number}`,
    author: "user-2",
    request: waitingSince === null ? null : { by: "user-2", ago: "", waitingSince },
    reRequest: false,
  };
}

// Unfiled, oldest request first, then Feature A in Ticket order, as the page
// model gives them.
const INBOX: ReviewInboxGroup[] = [
  {
    feature: null,
    prs: [inbox(11, null), inbox(16, null), inbox(12, "2026-10-26T00:00:00Z"), inbox(13, "2026-10-30T00:00:00Z")],
  },
  { feature: "Feature A", prs: [inbox(14, "2026-11-01T00:00:00Z"), inbox(15, null)] },
];

describe("the Review inbox sorted by column", () => {
  it("is in the default order with no sort", () => {
    expect(sortedReviewInbox(INBOX, null)).toEqual(INBOX);
  });

  it("by PR, orders each group's PRs by number, groups in place", () => {
    expect(numbers(sortedReviewInbox(INBOX, { column: "pr", direction: "descending" }))).toEqual([
      [null, [16, 13, 12, 11]],
      ["Feature A", [15, 14]],
    ]);
  });

  it("by Requested, orders each group's PRs most recent request first, or last, a request of unknown time the oldest", () => {
    expect(numbers(sortedReviewInbox(INBOX, { column: "requested", direction: "descending" }))).toEqual([
      [null, [13, 12, 11, 16]],
      ["Feature A", [14, 15]],
    ]);
    expect(numbers(sortedReviewInbox(INBOX, { column: "requested", direction: "ascending" }))).toEqual([
      [null, [11, 16, 12, 13]],
      ["Feature A", [15, 14]],
    ]);
  });
});

describe("clicking a sortable column's header", () => {
  it("sorts by it descending, then ascending, then returns to the default order", () => {
    const descending = nextSort(null, "pr");
    const ascending = nextSort(descending, "pr");

    expect(descending).toEqual({ column: "pr", direction: "descending" });
    expect(ascending).toEqual({ column: "pr", direction: "ascending" });
    expect(nextSort(ascending, "pr")).toBeNull();
  });

  it("sorts by another column descending, whatever the current sort's direction", () => {
    expect(nextSort({ column: "pr", direction: "descending" }, "updated")).toEqual({
      column: "updated",
      direction: "descending",
    });
    expect(nextSort({ column: "pr", direction: "ascending" }, "updated")).toEqual({
      column: "updated",
      direction: "descending",
    });
  });
});
