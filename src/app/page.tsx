import { redirect } from "next/navigation";
import { connection } from "next/server";
import { appStunt } from "./app-stunt.ts";
import { repositoryHref } from "./repository-href.ts";

export default async function HomePage() {
  await connection();
  const model = await appStunt().pageModel();
  if (model.landingRepository !== undefined) redirect(repositoryHref(model.landingRepository));

  return (
    <p className="text-muted-foreground">
      {model.checkedAt === undefined ? "Waiting for the first check." : "No Assigned PRs, and your Review inbox is empty."}
    </p>
  );
}
