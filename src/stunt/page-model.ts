import type { State } from "../data/store.ts";

export type AssignedPRRow = {
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAgo: string;
};

export type RepositoryModel = {
  name: string;
  assignedPRs: AssignedPRRow[];
};

export type PageModel = {
  checkedAt?: string;
  repositories: RepositoryModel[];
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });

// The time since `then`, in its largest whole unit, such as "3 hours ago".
function timeAgo(then: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(then)) / 1000);
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return "just now";
}

export function pageModel(state: State, now: Date): PageModel {
  const byRepository = new Map<string, State["assignedPRs"]>();
  for (const pr of state.assignedPRs) {
    byRepository.set(pr.repository, [...(byRepository.get(pr.repository) ?? []), pr]);
  }

  const repositories = [...byRepository.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, prs]) => ({
      name,
      assignedPRs: prs
        .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          updatedAgo: timeAgo(pr.updatedAt, now),
        })),
    }));

  return { checkedAt: state.checkedAt, repositories };
}
