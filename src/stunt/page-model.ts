import type { State } from "../data/store.ts";
import type { AssignedPR, Review, ReviewInboxPR } from "../github/prs.ts";
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
  // How many open Tasks, Assigned PRs, and Review inbox PRs it holds.
  counts:{ tasks: number; assignedPRs: number; reviewInbox: number };
  // Grouped by PR, the PR with the oldest Task first.
  tasks: TaskGroup[];
  assignedPRs: AssignedPRRow[];
  // Oldest request first.
  reviewInbox: ReviewInboxRow[];
};

// A repository's open Tasks in the All Tasks view.
export type RepositoryTasks = Pick<RepositoryModel, "name" | "tasks">;

export type PageModel = {
  checkedAt?: string;
  // The sidebar's repositories, the one with the most open Tasks first.
  repositories: RepositoryModel[];
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

export function pageModel(state: State, now: Date): PageModel {
  const repositories = repositoryNames(state).map((name): RepositoryModel => {
    const tasks = openTasks(state).filter((task) => task.repository === name);
    const assignedPRs = state.assignedPRs.filter((pr) => pr.repository === name);
    const reviewInbox = state.reviewInbox.filter((pr) => pr.repository === name);
    return {
      name,
      counts: { tasks: tasks.length, assignedPRs: assignedPRs.length, reviewInbox: reviewInbox.length },
      tasks: taskGroups(tasks, now),
      assignedPRs: assignedPRs
        .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((pr) => {
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
        }),
      reviewInbox: reviewInbox
        .toSorted((a, b) => requestTime(a) - requestTime(b))
        .map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.url,
          author: pr.author,
          request: pr.request === null ? null : { by: pr.request.by, ago: timeAgo(pr.request.waitingSince, now) },
          reRequest: pr.reRequest,
        })),
    };
  });
  repositories.sort((a, b) => b.counts.tasks - a.counts.tasks || a.name.localeCompare(b.name));

  const allTasks = repositories
    .filter((repository) => repository.counts.tasks > 0)
    .map(({ name, tasks }) => ({ name, tasks }));

  return { checkedAt: state.checkedAt, repositories, allTasks };
}
