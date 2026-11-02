import type { GitHubClient } from "./client.ts";

export type AssignedPR = {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
};

// GitHub's largest page. A check makes one query, and more only when a page
// overflows.
const PAGE_SIZE = 100;

// Every open PR listing the viewer as an assignee, drafts included, whoever
// authored it. The search index lags behind merges and closes, so each PR's
// own state is fetched too.
const ASSIGNED_PRS_QUERY = `query AssignedPRs($first: Int!, $after: String) {
  assigned: search(query: "is:pr is:open assignee:@me", type: ISSUE, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        state
        title
        url
        updatedAt
        author { login }
        repository { nameWithOwner }
      }
    }
  }
}`;

type SearchPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: {
    number: number;
    state: "OPEN" | "CLOSED" | "MERGED";
    title: string;
    url: string;
    updatedAt: string;
    author: { login: string } | null;
    repository: { nameWithOwner: string };
  }[];
};

function decodePage(body: unknown): SearchPage {
  const { data, errors } = body as { data?: { assigned?: SearchPage }; errors?: { message: string }[] };
  if (errors !== undefined && errors.length > 0) {
    throw new Error(`GitHub GraphQL query failed: ${errors.map((error) => error.message).join("; ")}`);
  }
  if (data?.assigned === undefined) throw new Error("GitHub GraphQL response has no search results");
  return data.assigned;
}

export async function fetchAssignedPRs(github: GitHubClient): Promise<AssignedPR[]> {
  const prs: AssignedPR[] = [];
  let after: string | null = null;
  for (;;) {
    const page = decodePage(await github.graphql(ASSIGNED_PRS_QUERY, { first: PAGE_SIZE, after }));
    for (const node of page.nodes) {
      if (node.state !== "OPEN") continue;
      prs.push({
        repository: node.repository.nameWithOwner,
        number: node.number,
        title: node.title,
        url: node.url,
        // A deleted account shows as GitHub's ghost user.
        author: node.author?.login ?? "ghost",
        updatedAt: node.updatedAt,
      });
    }
    if (!page.pageInfo.hasNextPage) return prs;
    after = page.pageInfo.endCursor;
  }
}
