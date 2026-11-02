import { connection } from "next/server";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { appStunt } from "../../../app-stunt.ts";

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
      {repository === undefined ? (
        <p className="text-muted-foreground">No Assigned PRs in {name}.</p>
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Assigned PRs</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">PR</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Author</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repository.assignedPRs.map((pr) => (
                <TableRow key={pr.number}>
                  <TableCell className="text-muted-foreground tabular-nums">#{pr.number}</TableCell>
                  <TableCell className="max-w-0 w-full truncate">
                    <a href={pr.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                      {pr.title}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{pr.author}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{pr.updatedAgo}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
