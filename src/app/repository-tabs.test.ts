import { describe, expect, it } from "vitest";
import { repositoryTabs } from "./repository-tabs.ts";

function selectedBy(search: string) {
  return repositoryTabs({
    name: "owner/repo",
    counts: { assignedPRs: 1, reviewInbox: 1 },
    searchParams: new URLSearchParams(search),
  })
    .filter((row) => row.selected)
    .map((row) => row.tab);
}

describe("a repository page's tabs", () => {
  it("lists Assigned PRs then Review inbox, with their counts and links, Assigned PRs selected with no tab", () => {
    expect(
      repositoryTabs({
        name: "owner/repo",
        counts: { assignedPRs: 3, reviewInbox: 0 },
        searchParams: new URLSearchParams(),
      }),
    ).toEqual([
      { tab: "assigned-prs", label: "Assigned PRs", count: 3, href: "/repos/owner/repo", selected: true },
      {
        tab: "review-inbox",
        label: "Review inbox",
        count: 0,
        href: "/repos/owner/repo?tab=review-inbox",
        selected: false,
      },
    ]);
  });

  it("counts zero Assigned PRs", () => {
    const tabs = repositoryTabs({
      name: "owner/repo",
      counts: { assignedPRs: 0, reviewInbox: 2 },
      searchParams: new URLSearchParams(),
    });

    expect(tabs.map((row) => [row.tab, row.count])).toEqual([
      ["assigned-prs", 0],
      ["review-inbox", 2],
    ]);
  });

  it("selects only Review inbox with tab review-inbox", () => {
    expect(selectedBy("tab=review-inbox")).toEqual(["review-inbox"]);
    expect(selectedBy("other=1&tab=review-inbox")).toEqual(["review-inbox"]);
  });

  it("selects only Assigned PRs with an unknown, empty, differently cased, or repeated tab", () => {
    expect(selectedBy("tab=assigned-prs")).toEqual(["assigned-prs"]);
    expect(selectedBy("tab=nope")).toEqual(["assigned-prs"]);
    expect(selectedBy("tab=")).toEqual(["assigned-prs"]);
    expect(selectedBy("tab=Review-Inbox")).toEqual(["assigned-prs"]);
    expect(selectedBy("tab=review-inbox&tab=review-inbox")).toEqual(["assigned-prs"]);
  });
});
