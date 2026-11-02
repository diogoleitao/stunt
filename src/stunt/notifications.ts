import { type Task, taskActor, taskTime } from "./tasks.ts";

// The desktop announcement of a repository's new Tasks of one kind.
export type Notification = {
  repository: string;
  kind: Task["kind"];
  // Such as "owner/repo: 2 new reviews".
  title: string;
  // One line per Task, oldest first, with its PR and who acted, such as
  // "#42 by octocat". A request too old for the check to have read names
  // no one.
  body: string;
};

// Each Task kind's noun, in the order Notifications announce them.
const NOUNS: Record<Task["kind"], [one: string, many: string]> = {
  "review request": ["Review request", "Review requests"],
  review: ["review", "reviews"],
  reply: ["reply", "replies"],
  comment: ["comment", "comments"],
};

const KINDS = Object.keys(NOUNS) as Task["kind"][];

function line(task: Task): string {
  const by = taskActor(task);
  return by === null ? `#${task.number}` : `#${task.number} by ${by}`;
}

// The Notifications announcing `tasks`, one per repository per Task kind,
// repositories by name, then kinds in the order Review request, review,
// reply, comment.
export function notifications(tasks: Task[]): Notification[] {
  const sorted = tasks.toSorted(
    (a, b) =>
      a.repository.localeCompare(b.repository) ||
      KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
      taskTime(a) - taskTime(b),
  );
  const groups = new Map<string, Task[]>();
  for (const task of sorted) {
    const key = `${task.repository} ${task.kind}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = [];
      groups.set(key, group);
    }
    group.push(task);
  }
  return [...groups.values()].map((group) => {
    const { repository, kind } = group[0];
    const [one, many] = NOUNS[kind];
    return {
      repository,
      kind,
      title: `${repository}: ${group.length} new ${group.length === 1 ? one : many}`,
      body: group.map(line).join("\n"),
    };
  });
}
