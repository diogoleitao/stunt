// Since when a Review request has waited, as a number to order by. A request
// too old for the check to have read is older than any other.
export function requestTime({ request }: { request: { waitingSince: string } | null }): number {
  return request === null ? -Infinity : Date.parse(request.waitingSince);
}
