import { connection } from "next/server";
import { AssignedPRTable } from "../../../assigned-pr-table.tsx";
import { appStunt } from "../../../app-stunt.ts";
import { ReviewInboxTable } from "../../../review-inbox-table.tsx";

export default async function RepositoryPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  await connection();
  const { owner, repo } = await params;
  const name = `${owner}/${repo}`;
  const repository = (await appStunt().pageModel()).repositories.find(
    (candidate) => candidate.name === name,
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        <a href={`https://github.com/${name}`} target="_blank" rel="noreferrer" className="hover:underline">
          {name}
        </a>
      </h1>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Assigned PRs</h2>
        {repository === undefined || repository.assignedPRs.length === 0 ? (
          <p className="text-muted-foreground">No Assigned PRs in {name}.</p>
        ) : (
          <AssignedPRTable groups={repository.assignedPRs} />
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Review inbox</h2>
        {repository === undefined || repository.reviewInbox.length === 0 ? (
          <p className="text-muted-foreground">Your Review inbox in {name} is empty.</p>
        ) : (
          <ReviewInboxTable groups={repository.reviewInbox} />
        )}
      </section>
    </div>
  );
}
