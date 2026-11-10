import { checkNow } from '../app-stunt.ts'

// The answer to a check that failed.
export type CheckFailure = { error: string }

// Checks at once for a stunt tab, answering when the check is done. Only
// stunt's own pages may ask: any other site open in the browser could
// otherwise keep checking and spend the GitHub rate limit.
export async function POST (request: Request): Promise<Response> {
  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') return new Response(null, { status: 403 })
  try {
    await checkNow()
  } catch (error) {
    const failure: CheckFailure = { error: error instanceof Error ? error.message : String(error) }
    return Response.json(failure, { status: 500 })
  }
  return new Response(null, { status: 204 })
}
