import type { GitHubClient } from "./client.ts";

export type AssignedPR = {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  updatedAt: string;
  // GitHub's own Review status, absent when the repository requires no reviews.
  reviewDecision: ReviewDecision | null;
  // Submitted reviews, oldest first. Pending reviews are left out.
  reviews: Review[];
  // Who a review is still requested from: user logins and team slugs.
  pendingReviewers: string[];
};

export type ReviewDecision = "REVIEW_REQUIRED" | "APPROVED" | "CHANGES_REQUESTED";

export type Review = {
  author: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  submittedAt: string;
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
        isDraft
        title
        url
        updatedAt
        author { login }
        repository { nameWithOwner }
        reviewDecision
        reviews(last: 100) {
          nodes {
            state
            submittedAt
            author { login }
          }
        }
        reviewRequests(first: 100) {
          nodes {
            requestedReviewer {
              __typename
              ... on Actor { login }
              ... on Team { combinedSlug }
            }
          }
        }
      }
    }
  }
}`;

type SearchPage = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: {
    number: number;
    state: "OPEN" | "CLOSED" | "MERGED";
    isDraft: boolean;
    title: string;
    url: string;
    updatedAt: string;
    author: { login: string } | null;
    repository: { nameWithOwner: string };
    reviewDecision: ReviewDecision | null;
    reviews: {
      nodes: (
        | { state: Review["state"]; submittedAt: string; author: { login: string } | null }
        | { state: "PENDING"; submittedAt: null; author: { login: string } | null }
      )[];
    };
    reviewRequests: {
      nodes: {
        requestedReviewer:
          | { __typename: "User" | "Bot" | "Mannequin"; login: string }
          | { __typename: "Team"; combinedSlug: string }
          | null;
      }[];
    };
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
        draft: node.isDraft,
        updatedAt: node.updatedAt,
        reviewDecision: node.reviewDecision,
        reviews: node.reviews.nodes.flatMap((review) =>
          review.state === "PENDING"
            ? []
            : [{ author: review.author?.login ?? "ghost", state: review.state, submittedAt: review.submittedAt }],
        ),
        // A request whose reviewer the viewer cannot see has no reviewer.
        pendingReviewers: node.reviewRequests.nodes.flatMap(({ requestedReviewer: reviewer }) => {
          if (reviewer === null) return [];
          return [reviewer.__typename === "Team" ? reviewer.combinedSlug : reviewer.login];
        }),
      });
    }
    if (!page.pageInfo.hasNextPage) return prs;
    after = page.pageInfo.endCursor;
  }
}
