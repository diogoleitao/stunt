// A repository's page, such as /repos/owner/repo for owner/repo.
export function repositoryHref(name: string): string {
  return `/repos/${name}`;
}
