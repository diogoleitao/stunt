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

// An open PR with a direct Review request still pending for the viewer.
export type ReviewInboxPR = {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  // The latest Review request for the viewer: who made it, when, and since
  // when it has waited, which is when the PR was last marked ready if that
  // came later. Null when the request is older than the events the query
  // reads.
  request: { by: string; requestedAt: string; waitingSince: string } | null;
  // Whether the viewer had submitted a review before the latest request.
  reRequest: boolean;
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

// A PR a check looks up by its repository and number, because it has open
// Tasks.
export type PRRef = { repository: string; number: number };

// What a PR with open Tasks looks like now.
export type TrackedPR = PRRef & {
  // Neither merged nor closed. A PR GitHub no longer finds is not open.
  open: boolean;
  // When the viewer submitted each of their reviews. Pending reviews are
  // left out.
  viewerReviews: string[];
  // The direct Review request still pending for the viewer, with when it was
  // made, null when it is older than the events the query reads. Null when
  // none is pending.
  pendingRequest: { requestedAt: string | null } | null;
};

// One check: the viewer, every open PR listing the viewer as an assignee,
// drafts included, whoever authored it, every open PR with a Review request
// for the viewer, and each PR in `lookups` by its repository and number. The
// search index lags behind merges, closes, and withdrawn requests, so each
// PR's own state and pending requests are fetched too. A page that overflows
// is followed by querying only its own search.
function checkQuery(lookups: number): string {
  const indexes = Array.from({ length: lookups }, (_, i) => i);
  const variables = indexes.map((i) => `, $owner${i}: String!, $name${i}: String!, $number${i}: Int!`).join("");
  const tracked = indexes
    .map(
      (i) => `
  tracked${i}: repository(owner: $owner${i}, name: $name${i}) {
    pullRequest(number: $number${i}) { ...InboxPR }
  }`,
    )
    .join("");
  return `query Check($first: Int!, $assigned: Boolean!, $assignedAfter: String, $inbox: Boolean!, $inboxAfter: String${variables}) {
  viewer { login }${tracked}
  assigned: search(query: "is:pr is:open assignee:@me", type: ISSUE, first: $first, after: $assignedAfter) @include(if: $assigned) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest { ...PR }
    }
  }
  inbox: search(query: "is:pr is:open user-review-requested:@me", type: ISSUE, first: $first, after: $inboxAfter) @include(if: $inbox) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest { ...InboxPR }
    }
  }
}

fragment InboxPR on PullRequest {
  ...PR
  timelineItems(last: 100, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes {
      ... on ReviewRequestedEvent {
        createdAt
        actor { login }
        requestedReviewer {
          __typename
          ... on Actor { login }
          ... on Team { combinedSlug }
        }
      }
    }
  }
  readyEvents: timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) {
    nodes {
      ... on ReadyForReviewEvent { createdAt }
    }
  }
}

fragment PR on PullRequest {
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
}`;
}

type RequestedReviewer =
  | { __typename: "User" | "Bot" | "Mannequin"; login: string }
  | { __typename: "Team"; combinedSlug: string }
  | null;

type PRNode = {
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
  reviewRequests: { nodes: { requestedReviewer: RequestedReviewer }[] };
};

type InboxNode = PRNode & {
  timelineItems: {
    nodes: { createdAt: string; actor: { login: string } | null; requestedReviewer: RequestedReviewer }[];
  };
  // When the PR was last marked ready for review, if ever.
  readyEvents: { nodes: { createdAt: string }[] };
};

type SearchPage<Node> = {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Node[];
};

type CheckData = {
  viewer: { login: string };
  assigned?: SearchPage<PRNode>;
  inbox?: SearchPage<InboxNode>;
  [lookup: `tracked${number}`]: { pullRequest: InboxNode | null } | null | undefined;
};

type GraphQLError = { message: string; type?: string; path?: (string | number)[] };

// A looked up PR GitHub no longer finds, because it or its repository was
// deleted or the viewer lost access, is no error: its lookup is null.
function isLookupNotFound(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND" && /^tracked\d+$/.test(String(error.path?.[0]));
}

function decode(body: unknown): CheckData {
  const { data, errors = [] } = body as { data?: CheckData; errors?: GraphQLError[] };
  const failures = errors.filter((error) => !isLookupNotFound(error));
  if (failures.length > 0) {
    throw new Error(`GitHub GraphQL query failed: ${failures.map((error) => error.message).join("; ")}`);
  }
  if (data?.viewer === undefined) throw new Error("GitHub GraphQL response has no viewer");
  return data;
}

// One search's paging: whether it has another page, and the cursor to ask
// for it after.
type Paging = { more: boolean; after: string | null };

function follow<Node>(paging: Paging, page: SearchPage<Node> | undefined, into: Node[]): void {
  if (page === undefined) throw new Error("GitHub GraphQL response has no search results");
  into.push(...page.nodes);
  paging.more = page.pageInfo.hasNextPage;
  paging.after = page.pageInfo.endCursor;
}

// A deleted account shows as GitHub's ghost user.
function login(actor: { login: string } | null): string {
  return actor?.login ?? "ghost";
}

function submittedReviews(node: PRNode): Review[] {
  return node.reviews.nodes.flatMap((review) =>
    review.state === "PENDING"
      ? []
      : [{ author: login(review.author), state: review.state, submittedAt: review.submittedAt }],
  );
}

function assignedPR(node: PRNode): AssignedPR {
  return {
    repository: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: login(node.author),
    draft: node.isDraft,
    updatedAt: node.updatedAt,
    reviewDecision: node.reviewDecision,
    reviews: submittedReviews(node),
    // A request whose reviewer the viewer cannot see has no reviewer.
    pendingReviewers: node.reviewRequests.nodes.flatMap(({ requestedReviewer: reviewer }) => {
      if (reviewer === null) return [];
      return [reviewer.__typename === "Team" ? reviewer.combinedSlug : reviewer.login];
    }),
  };
}

// Whether a review is requested from the viewer directly, not through a team.
function isViewer(reviewer: RequestedReviewer, viewer: string): boolean {
  return reviewer !== null && reviewer.__typename === "User" && reviewer.login === viewer;
}

// Whether a direct Review request is still pending for the viewer.
function isRequested(node: PRNode, viewer: string): boolean {
  return node.reviewRequests.nodes.some(({ requestedReviewer }) => isViewer(requestedReviewer, viewer));
}

// The latest direct Review request event for the viewer, if the query read it.
function latestRequest(node: InboxNode, viewer: string) {
  return node.timelineItems.nodes.findLast(({ requestedReviewer }) => isViewer(requestedReviewer, viewer));
}

// A request made while the PR was a draft waits from when the PR was marked
// ready.
function waitingSince(requestedAt: string, readyAt: string | undefined): string {
  return readyAt !== undefined && Date.parse(readyAt) > Date.parse(requestedAt) ? readyAt : requestedAt;
}

// The PR when it is in the viewer's Review inbox. Review requests on drafts
// are ignored until the PR is marked ready.
function reviewInboxPR(node: InboxNode, viewer: string): ReviewInboxPR | undefined {
  if (node.isDraft || !isRequested(node, viewer)) return undefined;
  const request = latestRequest(node, viewer);
  const readyAt = node.readyEvents.nodes.at(-1)?.createdAt;
  return {
    repository: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: login(node.author),
    request:
      request === undefined
        ? null
        : {
            by: login(request.actor),
            requestedAt: request.createdAt,
            waitingSince: waitingSince(request.createdAt, readyAt),
          },
    // Without the request's time, any review of the viewer's might be later.
    reRequest:
      request !== undefined &&
      submittedReviews(node).some(
        (review) => review.author === viewer && Date.parse(review.submittedAt) < Date.parse(request.createdAt),
      ),
  };
}

function trackedPR(
  ref: PRRef,
  lookup: { pullRequest: InboxNode | null } | null | undefined,
  viewer: string,
): TrackedPR {
  if (lookup === undefined) throw new Error("GitHub GraphQL response has no looked up PR");
  const node = lookup?.pullRequest ?? null;
  if (node === null) return { ...ref, open: false, viewerReviews: [], pendingRequest: null };
  return {
    ...ref,
    open: node.state === "OPEN",
    viewerReviews: submittedReviews(node)
      .filter((review) => review.author === viewer)
      .map((review) => review.submittedAt),
    pendingRequest: isRequested(node, viewer)
      ? { requestedAt: latestRequest(node, viewer)?.createdAt ?? null }
      : null,
  };
}

function lookupVariables(lookups: PRRef[]): Record<string, unknown> {
  return Object.fromEntries(
    lookups.flatMap(({ repository, number }, i) => {
      const [owner, name] = repository.split("/");
      return [
        [`owner${i}`, owner],
        [`name${i}`, name],
        [`number${i}`, number],
      ];
    }),
  );
}

export type CheckedPRs = {
  assignedPRs: AssignedPR[];
  reviewInbox: ReviewInboxPR[];
};

// What a check saw: its PRs, and what each PR it looked up looks like now.
export type Checked = CheckedPRs & {
  tracked: TrackedPR[];
};

// Looks up the PRs in `lookups` in the first query only.
export async function fetchPRs(github: GitHubClient, lookups: PRRef[] = []): Promise<Checked> {
  const assigned: PRNode[] = [];
  const inbox: InboxNode[] = [];
  const assignedPaging: Paging = { more: true, after: null };
  const inboxPaging: Paging = { more: true, after: null };
  let viewer = "";
  let tracked: TrackedPR[] | undefined;
  while (assignedPaging.more || inboxPaging.more) {
    const withAssigned = assignedPaging.more;
    const withInbox = inboxPaging.more;
    const looking = tracked === undefined ? lookups : [];
    const data = decode(
      await github.graphql(checkQuery(looking.length), {
        first: PAGE_SIZE,
        assigned: withAssigned,
        assignedAfter: assignedPaging.after,
        inbox: withInbox,
        inboxAfter: inboxPaging.after,
        ...lookupVariables(looking),
      }),
    );
    viewer = data.viewer.login;
    tracked ??= looking.map((ref, i) => trackedPR(ref, data[`tracked${i}`], viewer));
    if (withAssigned) follow(assignedPaging, data.assigned, assigned);
    if (withInbox) follow(inboxPaging, data.inbox, inbox);
  }
  const open = (node: PRNode) => node.state === "OPEN";
  return {
    assignedPRs: assigned.filter(open).map(assignedPR),
    reviewInbox: inbox
      .filter(open)
      .map((node) => reviewInboxPR(node, viewer))
      .filter((pr) => pr !== undefined),
    tracked: tracked ?? [],
  };
}
