import type { State } from "../data/store.ts";
import type { Activity, Checked, PRRef, ReviewInboxPR, TrackedPR } from "../github/prs.ts";

// One piece of activity on a PR to acknowledge by marking it done.
export type Task = {
  // The activity's identity. A Review request's is its PR and when it was
  // made, so a re-request is a new Task. A review's, reply's, or comment's is
  // its GitHub id.
  id: string;
  repository: string;
  number: number;
  title: string;
  url: string;
  // When the check that made the Task ran.
  createdAt: string;
  state: "open" | "done" | "expired";
} & (
  | { kind: "review request"; request: ReviewInboxPR["request"] }
  // Activity on an Assigned PR: who posted it, when, and where it is.
  | { kind: Activity["kind"]; activity: Pick<Activity, "by" | "at" | "url"> }
);

// A request too old for the check to have read is older than any other.
export function requestTime({ request }: Pick<ReviewInboxPR, "request">): number {
  return request === null ? -Infinity : Date.parse(request.waitingSince);
}

// A Review request Task counts from its request, any other from its activity.
export function taskTime(task: Task): number {
  return task.kind === "review request" ? requestTime(task) : Date.parse(task.activity.at);
}

// Who made a Review request Task's request or posted any other Task's
// activity. Null when a request is too old for the check to have read.
export function taskActor(task: Task): string | null {
  return task.kind === "review request" ? (task.request?.by ?? null) : task.activity.by;
}

function prKey({ repository, number }: PRRef): string {
  return `${repository}#${number}`;
}

function reviewRequestId(pr: ReviewInboxPR): string {
  return `review request ${prKey(pr)} ${pr.request?.requestedAt ?? "unknown"}`;
}

// Every PR with open Tasks, for the next check to look up.
export function trackedPRs(tasks: Task[]): PRRef[] {
  const prs = new Map<string, PRRef>();
  for (const { state, repository, number } of tasks) {
    if (state === "open") prs.set(prKey({ repository, number }), { repository, number });
  }
  return [...prs.values()];
}

// An open Task's state now that its PR looks like `pr`. Every Task expires
// when its PR was merged or closed. Only a Review request Task becomes done
// by itself; the others stay open until marked done.
function taskState(task: Task, pr: TrackedPR): Task["state"] {
  if (!pr.open) return "expired";
  return task.kind === "review request" ? reviewRequestState(task, pr) : "open";
}

// An open Review request Task's state now that its open PR looks like `pr`.
// It is done once the viewer submits a review after the request, and expires
// when the request was withdrawn or replaced by a later one. A request too
// old to have been read counts from when its Task was made.
function reviewRequestState(task: Task & { kind: "review request" }, pr: TrackedPR): Task["state"] {
  const requestedAt = task.request?.requestedAt ?? null;
  const since = Date.parse(requestedAt ?? task.createdAt);
  if (pr.viewerReviews.some((submittedAt) => Date.parse(submittedAt) > since)) return "done";
  if (pr.pendingRequest?.requestedAt !== requestedAt) return "expired";
  return "open";
}

export function withTasksDone(state: State, ids: string[]): State {
  const done = new Set(ids);
  return {
    ...state,
    tasks: state.tasks.map((task) => (done.has(task.id) && task.state === "open" ? { ...task, state: "done" } : task)),
  };
}

// What every Task made on `pr` by the check at `checkedAt` starts with.
function newTask(pr: Pick<Task, "repository" | "number" | "title" | "url">, checkedAt: string) {
  const { repository, number, title, url } = pr;
  return { repository, number, title, url, createdAt: checkedAt, state: "open" as const };
}

// The state after a check at `checkedAt` that saw `checked`, but for the
// Issue trackers and Feature links, which the check reads apart. The first
// check ever records the Baseline. Open Tasks follow what their PRs look like
// now, then each Review inbox PR's latest Review request and each new
// activity on an Assigned PR becomes a Task once.
export function applyCheck(
  state: State,
  checked: Checked,
  checkedAt: string,
): Omit<State, "issueTrackers" | "featureLinks"> {
  const tracked = new Map(checked.tracked.map((pr) => [prKey(pr), pr]));
  const tasks = state.tasks.map((task) => {
    const pr = task.state === "open" ? tracked.get(prKey(task)) : undefined;
    return pr === undefined ? task : { ...task, state: taskState(task, pr) };
  });

  const seen = new Set(tasks.map((task) => task.id));
  const assigned = new Map(checked.assignedPRs.map((pr) => [prKey(pr), pr]));
  const activity = checked.activity.flatMap((item): Task[] => {
    const pr = assigned.get(prKey(item));
    if (pr === undefined || seen.has(item.id)) return [];
    const { by, at, url } = item;
    return [{ id: item.id, kind: item.kind, ...newTask(pr, checkedAt), activity: { by, at, url } }];
  });
  const requests = checked.reviewInbox.flatMap((pr): Task[] => {
    const id = reviewRequestId(pr);
    if (seen.has(id)) return [];
    return [{ id, kind: "review request", ...newTask(pr, checkedAt), request: pr.request }];
  });

  return {
    checkedAt,
    baseline: state.baseline ?? checkedAt,
    assignedPRs: checked.assignedPRs,
    reviewInbox: checked.reviewInbox,
    tasks: [...tasks, ...requests, ...activity],
  };
}
