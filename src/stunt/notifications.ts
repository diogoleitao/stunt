import { requestTime, type ReviewInboxPR } from '../github/prs.ts'

// The desktop announcement of a repository's new Review requests.
export type Notification = {
  repository: string;
  // Such as "owner/repo: 2 new Review requests".
  title: string;
  // One line per Review request, oldest first, with its PR and who made it,
  // such as "#42 by octocat". A request too old for the check to have read
  // names no one.
  body: string;
}

// A Review request's identity: its PR and when it was made, so a re-request
// is a new Review request.
export function reviewRequestId (pr: ReviewInboxPR): string {
  return `${pr.repository}#${pr.number} ${pr.request?.requestedAt ?? 'unknown'}`
}

function line (pr: ReviewInboxPR): string {
  return pr.request === null ? `#${pr.number}` : `#${pr.number} by ${pr.request.by}`
}

// The Notifications announcing the Review requests of `prs`, one per
// repository, repositories by name.
export function notifications (prs: ReviewInboxPR[]): Notification[] {
  const sorted = prs.toSorted((a, b) => a.repository.localeCompare(b.repository) || requestTime(a) - requestTime(b))
  const groups = new Map<string, ReviewInboxPR[]>()
  for (const pr of sorted) {
    let group = groups.get(pr.repository)
    if (group === undefined) {
      group = []
      groups.set(pr.repository, group)
    }
    group.push(pr)
  }
  return [...groups].map(([repository, group]) => ({
    repository,
    title: `${repository}: ${group.length} new ${group.length === 1 ? 'Review request' : 'Review requests'}`,
    body: group.map(line).join('\n'),
  }))
}
