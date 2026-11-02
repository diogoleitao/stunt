import type { State } from "../data/store.ts";
import type { Checked, PRRef, ReviewInboxPR, TrackedPR } from "../github/prs.ts";

// One piece of activity on a PR to acknowledge by marking it done. Only
// Review requests make Tasks so far.
export type Task = {
  // The activity's identity. A Review request's is its PR and when it was
  // made, so a re-request is a new Task.
  id: string;
  kind: "review request";
  repository: string;
  number: number;
  title: string;
  url: string;
  request: ReviewInboxPR["request"];
  // When the check that made the Task ran.
  createdAt: string;
  state: "open" | "done" | "expired";
};

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

// An open Review request Task's state now that its PR looks like `pr`. It is
// done once the viewer submits a review after the request, and expires when
// the PR was merged or closed, or the request was withdrawn or replaced by a
// later one. A request too old to have been read counts from when its Task
// was made.
function reviewRequestState(task: Task, pr: TrackedPR): Task["state"] {
  if (!pr.open) return "expired";
  const requestedAt = task.request?.requestedAt ?? null;
  const since = Date.parse(requestedAt ?? task.createdAt);
  if (pr.viewerReviews.some((submittedAt) => Date.parse(submittedAt) > since)) return "done";
  if (pr.pendingRequest?.requestedAt !== requestedAt) return "expired";
  return "open";
}

export function withTaskDone(state: State, id: string): State {
  return {
    ...state,
    tasks: state.tasks.map((task) => (task.id === id && task.state === "open" ? { ...task, state: "done" } : task)),
  };
}

// The state after a check at `checkedAt` that saw `checked`. The first check
// ever records the Baseline. Open Tasks follow what their PRs look like now,
// then each Review inbox PR's latest Review request becomes a Task once.
export function applyCheck(state: State, checked: Checked, checkedAt: string): State {
  const tracked = new Map(checked.tracked.map((pr) => [prKey(pr), pr]));
  const tasks = state.tasks.map((task) => {
    const pr = task.state === "open" ? tracked.get(prKey(task)) : undefined;
    return pr === undefined ? task : { ...task, state: reviewRequestState(task, pr) };
  });

  const seen = new Set(tasks.map((task) => task.id));
  const created = checked.reviewInbox.flatMap((pr): Task[] => {
    const id = reviewRequestId(pr);
    if (seen.has(id)) return [];
    return [
      {
        id,
        kind: "review request",
        repository: pr.repository,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        request: pr.request,
        createdAt: checkedAt,
        state: "open",
      },
    ];
  });

  return {
    checkedAt,
    baseline: state.baseline ?? checkedAt,
    assignedPRs: checked.assignedPRs,
    reviewInbox: checked.reviewInbox,
    tasks: [...tasks, ...created],
  };
}
