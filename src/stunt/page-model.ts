import type { State } from "../data/store.ts";
import type { AssignedPR, Review, ReviewInboxPR } from "../github/prs.ts";
import type { Task } from "./tasks.ts";

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
  // Grouped by PR, the PR with the oldest Task first.
  tasks: TaskGroup[];
  assignedPRs: AssignedPRRow[];
  // Oldest request first.
  reviewInbox: ReviewInboxRow[];
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

// A request too old for the check to have read is older than any other.
function requestTime({ request }: Pick<ReviewInboxPR, "request">): number {
  return request === null ? -Infinity : Date.parse(request.waitingSince);
}

// A Review request Task counts from its request, any other from its activity.
function taskTime(task: Task): number {
  return task.kind === "review request" ? requestTime(task) : Date.parse(task.activity.at);
}

function taskRow(task: Task, now: Date): TaskRow {
  if (task.kind !== "review request") {
    const { by, at, url } = task.activity;
    return { id: task.id, kind: task.kind, url, by, ago: timeAgo(at, now) };
  }
  return {
    id: task.id,
    kind: task.kind,
    url: `${task.url}/files`,
    by: task.request?.by ?? null,
    ago: task.request === null ? null : timeAgo(task.request.waitingSince, now),
  };
}

function openTasks(state: State): Task[] {
  return state.tasks.filter((task) => task.state === "open");
}

// Every repository with an Assigned PR, a Review inbox PR, or an open Task.
function repositoryNames(state: State): string[] {
  const names = new Set([...state.assignedPRs, ...state.reviewInbox, ...openTasks(state)].map((pr) => pr.repository));
  return [...names].sort((a, b) => a.localeCompare(b));
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
  const repositories = repositoryNames(state).map((name) => {
    const tasks = openTasks(state).filter((task) => task.repository === name);
    return {
      name,
      tasks: taskGroups(tasks, now),
      assignedPRs: state.assignedPRs
        .filter((pr) => pr.repository === name)
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
      reviewInbox: state.reviewInbox
        .filter((pr) => pr.repository === name)
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

  return { checkedAt: state.checkedAt, repositories };
}
