import type { GitHubClient } from "./client.ts";
import { dataOf } from "./graphql.ts";

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
  // Someone else authored it, and a direct Review request for the viewer is
  // pending on it or the viewer never submitted a review on it.
  pendingReview: boolean;
  // The issue its body names as its Ticket, null when it names none.
  ticket: number | null;
};

// An open PR with a direct Review request still pending for the viewer.
export type ReviewInboxPR = {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string;
  updatedAt: string;
  // The issue its body names as its Ticket, null when it names none.
  ticket: number | null;
  // The latest Review request for the viewer: who made it, when, and since
  // when it has waited, which is when the PR was last marked ready if that
  // came later. Null when the request is older than the events the query
  // reads.
  request: { by: string; requestedAt: string; waitingSince: string } | null;
  // Whether the viewer had submitted a review before the latest request.
  reRequest: boolean;
};

// A request too old for the check to have read is older than any other.
export function requestTime({ request }: Pick<ReviewInboxPR, "request">): number {
  return request === null ? -Infinity : Date.parse(request.waitingSince);
}

export type ReviewDecision = "REVIEW_REQUIRED" | "APPROVED" | "CHANGES_REQUESTED";

export type Review = {
  author: string;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED";
  submittedAt: string;
};

// GitHub's largest page. A check makes one query, and more only when a page
// overflows.
const PAGE_SIZE = 100;

// A PR by its repository and number.
export type PRRef = { repository: string; number: number };

// One check: the viewer, every open PR listing the viewer as an assignee,
// drafts included, whoever authored it, and every open PR with a Review
// request for the viewer. The search index lags behind merges, closes, and
// withdrawn requests, so each PR's own state and pending requests are fetched
// too. A page that overflows is followed by querying only its own search.
const CHECK_QUERY = `query Check($first: Int!, $assigned: Boolean!, $assignedAfter: String, $inbox: Boolean!, $inboxAfter: String) {
  viewer { login }
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
  body
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

type RequestedReviewer =
  | { __typename: "User" | "Bot" | "Mannequin"; login: string }
  | { __typename: "Team"; combinedSlug: string }
  | null;

type ReviewNode =
  | { state: Review["state"]; submittedAt: string; author: { login: string } | null }
  | { state: "PENDING"; submittedAt: null; author: { login: string } | null };

type PRNode = {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  title: string;
  url: string;
  updatedAt: string;
  body: string;
  author: { login: string } | null;
  repository: { nameWithOwner: string };
  reviewDecision: ReviewDecision | null;
  reviews: { nodes: ReviewNode[] };
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
};

function decode(body: unknown): CheckData {
  const data = dataOf<CheckData>(body);
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

// The line by which a PR's body names its Ticket, in any case, as GitHub
// reads `closes #N`. Any other mention of an issue does not name it.
const TICKET_LINE = /^(?:Closes|Part of) #(\d+)\b/im;

// The issue a PR's body names as its Ticket, by its first Ticket line.
function ticket(node: PRNode): number | null {
  const number = TICKET_LINE.exec(node.body)?.[1];
  return number === undefined ? null : Number(number);
}

function assignedPR(node: PRNode, viewer: string): AssignedPR {
  const reviews = submittedReviews(node);
  return {
    repository: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    url: node.url,
    author: login(node.author),
    draft: node.isDraft,
    updatedAt: node.updatedAt,
    reviewDecision: node.reviewDecision,
    reviews,
    // A request whose reviewer the viewer cannot see has no reviewer.
    pendingReviewers: node.reviewRequests.nodes.flatMap(({ requestedReviewer: reviewer }) => {
      if (reviewer === null) return [];
      return [reviewer.__typename === "Team" ? reviewer.combinedSlug : reviewer.login];
    }),
    pendingReview:
      login(node.author) !== viewer &&
      (isRequested(node, viewer) || !reviews.some((review) => review.author === viewer)),
    ticket: ticket(node),
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
    updatedAt: node.updatedAt,
    ticket: ticket(node),
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

// What a check saw.
export type CheckedPRs = {
  assignedPRs: AssignedPR[];
  reviewInbox: ReviewInboxPR[];
};

export async function fetchPRs(github: GitHubClient): Promise<CheckedPRs> {
  const assigned: PRNode[] = [];
  const inbox: InboxNode[] = [];
  const assignedPaging: Paging = { more: true, after: null };
  const inboxPaging: Paging = { more: true, after: null };
  let viewer = "";
  while (assignedPaging.more || inboxPaging.more) {
    const withAssigned = assignedPaging.more;
    const withInbox = inboxPaging.more;
    const data = decode(
      await github.graphql(CHECK_QUERY, {
        first: PAGE_SIZE,
        assigned: withAssigned,
        assignedAfter: assignedPaging.after,
        inbox: withInbox,
        inboxAfter: inboxPaging.after,
      }),
    );
    viewer = data.viewer.login;
    if (withAssigned) follow(assignedPaging, data.assigned, assigned);
    if (withInbox) follow(inboxPaging, data.inbox, inbox);
  }
  const open = (node: PRNode) => node.state === "OPEN";
  return {
    assignedPRs: assigned.filter(open).map((node) => assignedPR(node, viewer)),
    reviewInbox: inbox
      .filter(open)
      .map((node) => reviewInboxPR(node, viewer))
      .filter((pr) => pr !== undefined),
  };
}
