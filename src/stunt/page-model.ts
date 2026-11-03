import type { State } from "../data/store.ts";
import type { AssignedPR, Review, ReviewInboxPR } from "../github/prs.ts";
import type { FeatureLink } from "./features.ts";
import type { IssueTracker } from "./issue-trackers.ts";
import { requestTime, type Task, taskActor, taskTime } from "./tasks.ts";

export type ReviewStatus = "review required" | "approved" | "changes requested";

export type AssignedPRRow = {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  reviewStatus: ReviewStatus;
  openTasks: number;
  updatedAgo: string;
  // Each reviewer's latest review, most recent first.
  reviews: ReviewRow[];
  // Who a review is still requested from: user logins and team slugs.
  pendingReviewers: string[];
};

// PRs under the Feature they ship, by the Feature's name, or under Unfiled
// when the Feature is null.
export type FeatureGroup<Row> = {
  feature: string | null;
  prs: Row[];
};

export type AssignedPRGroup = FeatureGroup<AssignedPRRow>;

export type ReviewInboxGroup = FeatureGroup<ReviewInboxRow>;

export type ReviewRow = {
  reviewer: string;
  state: "approved" | "changes requested" | "commented" | "dismissed";
  submittedAgo: string;
};

const REVIEW_STATES = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
} as const satisfies Record<Review["state"], ReviewRow["state"]>;

export type ReviewInboxRow = {
  number: number;
  title: string;
  url: string;
  author: string;
  // Who requested the viewer's review, and how long it has waited. Null when
  // the request is too old for the check to have read.
  request: { by: string; ago: string } | null;
  // The viewer had already reviewed the PR before this request.
  reRequest: boolean;
};

// A PR's open Tasks, oldest first.
export type TaskGroup = {
  number: number;
  title: string;
  url: string;
  tasks: TaskRow[];
};

export type TaskRow = {
  id: string;
  kind: Task["kind"];
  // Where on GitHub to act on it: a Review request opens the PR's Files
  // changed tab, any other Task the exact review, reply, or comment.
  url: string;
  // Who made the request or posted the activity, and how long ago. Null when
  // a request is too old for the check to have read.
  by: string | null;
  ago: string | null;
};

export type RepositoryModel = {
  name: string;
  // The Issue tracker its PRs are grouped by, null when it declares none
  // stunt groups by, which leaves every PR Unfiled.
  issueTracker: IssueTracker | null;
  // How many open Tasks, Assigned PRs, and Review inbox PRs it holds.
  counts:{ tasks: number; assignedPRs: number; reviewInbox: number };
  // Grouped by PR, the PR with the oldest Task first.
  tasks: TaskGroup[];
  // Grouped by Feature, the Feature with the most recently updated PR first,
  // each Feature's PRs in Ticket order, then Unfiled, most recently updated
  // first.
  assignedPRs: AssignedPRGroup[];
  // Grouped by Feature in a GitHub repository, as Assigned PRs are, and all
  // Unfiled elsewhere. Unfiled, and PRs a Feature's Ticket order leaves
  // tied, oldest request first.
  reviewInbox: ReviewInboxGroup[];
};

// A repository's open Tasks in the All Tasks view.
export type RepositoryTasks = Pick<RepositoryModel, "name" | "tasks">;

export type PageModel = {
  checkedAt?: string;
  // The sidebar's repositories, by name.
  repositories: RepositoryModel[];
  // The repository the home page opens: the one with the most open Tasks, the
  // first by name among those tied. Unset with no repositories.
  landingRepository?: string;
  // Every repository with open Tasks, in sidebar order.
  allTasks: RepositoryTasks[];
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

const DECISIONS = {
  REVIEW_REQUIRED: "review required",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
} as const satisfies Record<NonNullable<AssignedPR["reviewDecision"]>, ReviewStatus>;

// A verdict is a review that approves or requests changes.
function isVerdict(review: Review): boolean {
  return review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
}

// Each reviewer's standing review, the PR's author left out: their latest
// review, except that a comment never replaces a verdict. A dismissed verdict
// is no longer one, and GitHub keeps its submission time, so a comment after
// it stands whether it came before or after the dismissal.
function standingReviews(pr: AssignedPR): Review[] {
  const standing = new Map<string, Review>();
  for (const review of pr.reviews) {
    if (review.author === pr.author) continue;
    const current = standing.get(review.author);
    if (review.state === "COMMENTED" && current !== undefined && isVerdict(current)) continue;
    standing.set(review.author, review);
  }
  return [...standing.values()];
}

// GitHub's review decision when it reports one. Otherwise any reviewer
// requesting changes gives changes requested, else any approval gives
// approved, else review required.
function reviewStatus(pr: AssignedPR, reviews: Review[]): ReviewStatus {
  if (pr.reviewDecision !== null) return DECISIONS[pr.reviewDecision];
  const states = new Set(reviews.map((review) => review.state));
  if (states.has("CHANGES_REQUESTED")) return "changes requested";
  if (states.has("APPROVED")) return "approved";
  return "review required";
}

function taskRow(task: Task, now: Date): TaskRow {
  const row = { id: task.id, kind: task.kind, by: taskActor(task) };
  if (task.kind !== "review request") {
    const { at, url } = task.activity;
    return { ...row, url, ago: timeAgo(at, now) };
  }
  return {
    ...row,
    url: `${task.url}/files`,
    ago: task.request === null ? null : timeAgo(task.request.waitingSince, now),
  };
}

function openTasks(state: State): Task[] {
  return state.tasks.filter((task) => task.state === "open");
}

// Every repository with an Assigned PR, a Review inbox PR, or an open Task.
function repositoryNames(state: State): string[] {
  const names = new Set([...state.assignedPRs, ...state.reviewInbox, ...openTasks(state)].map((pr) => pr.repository));
  return [...names];
}

function taskGroups(tasks: Task[], now: Date): TaskGroup[] {
  const groups = new Map<number, TaskGroup>();
  for (const task of tasks.toSorted((a, b) => taskTime(a) - taskTime(b))) {
    let group = groups.get(task.number);
    if (group === undefined) {
      group = { number: task.number, title: task.title, url: task.url, tasks: [] };
      groups.set(task.number, group);
    }
    group.tasks.push(taskRow(task, now));
  }
  return [...groups.values()];
}

// An Assigned PR's row, counting its open Tasks among the repository's
// `tasks`.
function assignedPRRow(pr: AssignedPR, tasks: Task[], now: Date): AssignedPRRow {
  const reviews = standingReviews(pr);
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author,
    draft: pr.draft,
    reviewStatus: reviewStatus(pr, reviews),
    openTasks: tasks.filter((task) => task.number === pr.number).length,
    updatedAgo: timeAgo(pr.updatedAt, now),
    reviews: reviews
      .toSorted((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
      .map((review) => ({
        reviewer: review.author,
        state: REVIEW_STATES[review.state],
        submittedAgo: timeAgo(review.submittedAt, now),
      })),
    pendingReviewers: pr.pendingReviewers,
  };
}

// `prs` under the Feature whose Ticket `links` them, the Feature with the
// most recently updated PR first, each Feature's PRs in Ticket order, those
// not among its Tickets last. The PRs no Ticket links are Unfiled, last. PRs
// Ticket order leaves tied, and Unfiled PRs, are in `order`.
function featureGroups<PR extends { number: number; updatedAt: string }, Row>(
  prs: PR[],
  links: FeatureLink[],
  order: (a: PR, b: PR) => number,
  row: (pr: PR) => Row,
): FeatureGroup<Row>[] {
  const linked = new Map(links.map((link) => [link.number, link]));
  const ticketOrder = (pr: PR) => linked.get(pr.number)?.ticketOrder ?? Number.POSITIVE_INFINITY;
  const lastUpdated = (prs: PR[]) => Math.max(...prs.map((pr) => Date.parse(pr.updatedAt)));
  const features = new Map<string, { name: string; prs: PR[] }>();
  const unfiled: PR[] = [];
  for (const pr of prs) {
    const link = linked.get(pr.number);
    if (link === undefined) unfiled.push(pr);
    else {
      const feature = features.get(link.featureId) ?? { name: link.featureName, prs: [] };
      features.set(link.featureId, { ...feature, prs: [...feature.prs, pr] });
    }
  }
  const groups = [...features.values()]
    .toSorted((a, b) => lastUpdated(b.prs) - lastUpdated(a.prs))
    .map(({ name, prs }) => ({
      feature: name,
      // Infinity minus Infinity is NaN, which leaves two PRs to `order`.
      prs: prs.toSorted((a, b) => ticketOrder(a) - ticketOrder(b) || order(a, b)).map(row),
    }));
  return unfiled.length === 0 ? groups : [...groups, { feature: null, prs: unfiled.toSorted(order).map(row) }];
}

export function pageModel(state: State, now: Date): PageModel {
  const repositories = repositoryNames(state).map((name): RepositoryModel => {
    const tasks = openTasks(state).filter((task) => task.repository === name);
    const assignedPRs = state.assignedPRs.filter((pr) => pr.repository === name);
    const reviewInbox = state.reviewInbox.filter((pr) => pr.repository === name);
    const issueTracker = state.issueTrackers[name] ?? null;
    const links = state.featureLinks[name] ?? [];
    return {
      name,
      issueTracker,
      counts: { tasks: tasks.length, assignedPRs: assignedPRs.length, reviewInbox: reviewInbox.length },
      tasks: taskGroups(tasks, now),
      assignedPRs: featureGroups(
        assignedPRs,
        links,
        (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        (pr) => assignedPRRow(pr, tasks, now),
      ),
      // Only a GitHub repository groups its Review inbox by Feature.
      reviewInbox: featureGroups(
        reviewInbox,
        issueTracker === "GitHub" ? links : [],
        (a, b) => requestTime(a) - requestTime(b),
        (pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          request: pr.request === null ? null : { by: pr.request.by, ago: timeAgo(pr.request.waitingSince, now) },
          reRequest: pr.reRequest,
        }),
      ),
    };
  });
  repositories.sort((a, b) => a.name.localeCompare(b.name));

  const landingRepository = repositories.reduce<RepositoryModel | undefined>(
    (busiest, repository) =>
      busiest === undefined || repository.counts.tasks > busiest.counts.tasks ? repository : busiest,
    undefined,
  )?.name;

  const allTasks = repositories
    .filter((repository) => repository.counts.tasks > 0)
    .map(({ name, tasks }) => ({ name, tasks }));

  return { checkedAt: state.checkedAt, repositories, landingRepository, allTasks };
}
