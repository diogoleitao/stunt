// The answer to a check that failed.
export type CheckFailure = { error: string };

// Whether `request` comes from one of stunt's own pages. Any other site open
// in the browser could otherwise keep checking and spend the GitHub rate
// limit.
export function fromStunt(request: Request): boolean {
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

// Answers once `checking` settles: no content when the check succeeded, and
// the check's error when it failed.
export async function answerCheck(checking: Promise<void>): Promise<Response> {
  try {
    await checking;
  } catch (error) {
    const failure: CheckFailure = { error: error instanceof Error ? error.message : String(error) };
    return Response.json(failure, { status: 500 });
  }
  return new Response(null, { status: 204 });
}
