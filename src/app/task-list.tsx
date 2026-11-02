import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TaskGroup } from "../stunt/page-model.ts";
import { markTaskDone } from "./actions.ts";
import { Badge } from "./badge.tsx";

// A repository's open Tasks, grouped by PR. Each Task links to where to act
// on it on GitHub, and can be marked done.
export function TaskList({ prs }: { prs: TaskGroup[] }) {
  return (
    <div className="flex flex-col gap-3">
      {prs.map((pr) => (
        <div key={pr.number} className="rounded-lg border">
          <div className="flex items-center gap-2 border-b px-3 py-2 text-sm">
            <span className="text-muted-foreground tabular-nums">#{pr.number}</span>
            <a href={pr.url} target="_blank" rel="noreferrer" className="truncate font-medium hover:underline">
              {pr.title}
            </a>
          </div>
          <ul className="divide-y">
            {pr.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <Badge className="border-border text-muted-foreground">{task.kind}</Badge>
                <a href={task.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                  Review requested by {task.by ?? "unknown"}
                </a>
                <span className="ml-auto shrink-0 text-muted-foreground">{task.ago ?? "unknown"}</span>
                <form action={markTaskDone.bind(null, task.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    <Check />
                    Done
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
