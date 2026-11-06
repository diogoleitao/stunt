import { checkNow } from "../app-stunt.ts";
import { answerCheck, fromStunt } from "./answer.ts";

// Checks at once for a stunt tab, answering when the check is done.
export async function POST(request: Request): Promise<Response> {
  if (!fromStunt(request)) return new Response(null, { status: 403 });
  return answerCheck(checkNow());
}
