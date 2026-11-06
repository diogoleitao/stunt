import { isRepositoryName } from "../../../../github/prs.ts";
import { checkRepositoryNow } from "../../../app-stunt.ts";
import { answerCheck, fromStunt } from "../../answer.ts";

// Makes a Repository check of owner/repo for a stunt tab, answering when the
// check is done.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ owner: string; repo: string }> },
): Promise<Response> {
  if (!fromStunt(request)) return new Response(null, { status: 403 });
  const { owner, repo } = await params;
  const repository = `${owner}/${repo}`;
  if (!isRepositoryName(repository)) return new Response(null, { status: 400 });
  return answerCheck(checkRepositoryNow(repository));
}
