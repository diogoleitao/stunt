import type { RepositoryModel } from "../stunt/page-model.ts";
import { type RepositoryTab, repositoryHref, TAB_PARAM } from "./repository-href.ts";

export type RepositoryTabRow = {
  tab: RepositoryTab;
  label: string;
  // How many PRs the tab's list holds.
  count: number;
  // The repository's page open on this tab.
  href: string;
  selected: boolean;
};

type Counts = RepositoryModel["counts"];

const TABS: { tab: RepositoryTab; label: string; count: keyof Counts }[] = [
  { tab: "assigned-prs", label: "Assigned PRs", count: "assignedPRs" },
  { tab: "review-inbox", label: "Review inbox", count: "reviewInbox" },
];

// A repository page's tabs, Assigned PRs then Review inbox. A single tab
// parameter of review-inbox in `searchParams` selects Review inbox, and
// anything else, or none, selects Assigned PRs.
export function repositoryTabs({
  name,
  counts,
  searchParams,
}: {
  name: string;
  counts: Counts;
  searchParams: URLSearchParams;
}): RepositoryTabRow[] {
  const tabParams = searchParams.getAll(TAB_PARAM);
  const selected: RepositoryTab =
    tabParams.length === 1 && tabParams[0] === "review-inbox" ? "review-inbox" : "assigned-prs";
  return TABS.map(({ tab, label, count }) => ({
    tab,
    label,
    count: counts[count],
    href: repositoryHref(name, tab),
    selected: tab === selected,
  }));
}
