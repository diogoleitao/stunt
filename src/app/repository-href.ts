// A tab of a repository's page.
export type RepositoryTab = 'assigned-prs' | 'review-inbox'

// The search parameter naming a repository page's tab.
export const TAB_PARAM = 'tab'

// A repository's page, such as /repos/owner/repo for owner/repo, open on
// `tab`: the Assigned PRs tab has the bare link, and the Review inbox tab adds
// ?tab=review-inbox.
export function repositoryHref (name: string, tab: RepositoryTab = 'assigned-prs'): string {
  const href = `/repos/${name}`
  return tab === 'review-inbox' ? `${href}?${TAB_PARAM}=review-inbox` : href
}
