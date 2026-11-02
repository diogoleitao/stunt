import Link from "next/link";
import { connection } from "next/server";
import { appStunt } from "../app-stunt.ts";
import { repositoryHref } from "../repository-href.ts";
import { TaskList } from "../task-list.tsx";

export default async function AllTasksPage() {
  await connection();
  const { allTasks } = await appStunt().pageModel();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">All Tasks</h1>
      {allTasks.length === 0 ? (
        <p className="text-muted-foreground">No open Tasks.</p>
      ) : (
        allTasks.map((repository) => (
          <section key={repository.name} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">
              <Link href={repositoryHref(repository.name)} className="hover:underline">
                {repository.name}
              </Link>
            </h2>
            <TaskList prs={repository.tasks} />
          </section>
        ))
      )}
    </div>
  );
}
