import type { GitHubClient } from "./client.ts";
import { dataOf, type GraphQLError, issueParameters, issueVariables } from "./graphql.ts";

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

// Activity on an Assigned PR that can make a Task: a submitted review that
// was not dismissed, a review that only holds replies to existing threads,
// or a conversation comment.
export type Activity = {
  // GitHub's id of the review or comment.
  id: string;
  kind: "review" | "reply" | "comment";
  repository: string;
  number: number;
  by: string;
  // When it was submitted or created.
  at: string;
  // Where it is on GitHub: the review, its first reply, or the comment.
  url: string;
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
  const variables = issueParameters(lookups);
  const tracked = Array.from({ length: lookups }, (_, i) => i)
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
      ... on PullRequest { ...AssignedPR }
    }
  }
  inbox: search(query: "is:pr is:open user-review-requested:@me", type: ISSUE, first: $first, after: $inboxAfter) @include(if: $inbox) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest { ...InboxPR }
    }
  }
}

fragment AssignedPR on PullRequest {
  ...PR
  reviews(last: 100) {
    nodes {
      id
      url
      body
      author { __typename }
    }
  }
  comments(last: 100) {
    nodes {
      id
      url
      createdAt
      author { __typename login }
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
}

type RequestedReviewer =
  | { __typename: "User" | "Bot" | "Mannequin"; login: string }
  | { __typename: "Team"; combinedSlug: string }
  | null;

type ReviewNode =
  | { state: Review["state"]; submittedAt: string; author: { login: string } | null }
  | { state: "PENDING"; submittedAt: null; author: { login: string } | null };

type PRNode<Reviews extends ReviewNode = ReviewNode> = {
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
  reviews: { nodes: Reviews[] };
  reviewRequests: { nodes: { requestedReviewer: RequestedReviewer }[] };
};

// An author with their type, which tells bots apart.
type TypedAuthor = { __typename: string; login: string } | null;

type AssignedNode = PRNode<ReviewNode & { id: string; url: string; body: string; author: TypedAuthor }> & {
  comments: { nodes: { id: string; url: string; createdAt: string; author: TypedAuthor }[] };
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
  assigned?: SearchPage<AssignedNode>;
  inbox?: SearchPage<InboxNode>;
  [lookup: `tracked${number}`]: { pullRequest: InboxNode | null } | null | undefined;
};

// A looked up PR GitHub no longer finds, because it or its repository was
// deleted or the viewer lost access, is no error: its lookup is null.
function isLookupNotFound(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND" && /^tracked\d+$/.test(String(error.path?.[0]));
}

function decode(body: unknown): CheckData {
  const data = dataOf<CheckData>(body, isLookupNotFound);
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
    ticket: ticket(node),
  };
}

// An Assigned PR's activity after `since` and not in `known`, by someone
// other than the viewer and not a bot. Pending and dismissed reviews are no
// activity.
function newActivity(node: AssignedNode, viewer: string, since: string, known: ReadonlySet<string>): Activity[] {
  const pr = { repository: node.repository.nameWithOwner, number: node.number };
  const isNew = (id: string, author: TypedAuthor, at: string) =>
    author?.__typename !== "Bot" &&
    login(author) !== viewer &&
    !known.has(id) &&
    Date.parse(at) > Date.parse(since);
  const reviews = node.reviews.nodes.flatMap((review): Activity[] => {
    if (review.state === "PENDING" || review.state === "DISMISSED") return [];
    if (!isNew(review.id, review.author, review.submittedAt)) return [];
    return [{ ...pr, id: review.id, kind: "review", by: login(review.author), at: review.submittedAt, url: review.url }];
  });
  const comments = node.comments.nodes.flatMap((comment): Activity[] => {
    if (!isNew(comment.id, comment.author, comment.createdAt)) return [];
    return [{ ...pr, id: comment.id, kind: "comment", by: login(comment.author), at: comment.createdAt, url: comment.url }];
  });
  return [...reviews, ...comments];
}

// The inline comments of reviews, by their ids. Asked only for new reviews
// that might only hold replies, because asking for every review's inline
// comments in the check would cost far more of the hourly GraphQL budget.
const REPLIES_QUERY = `query Replies($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on PullRequestReview {
      id
      comments(first: 100) {
        nodes {
          url
          replyTo { id }
        }
      }
    }
  }
}`;

// A review GitHub no longer finds, because it was deleted since the check
// query, is null.
type RepliesData = {
  nodes: ({ id: string; comments: { nodes: { url: string; replyTo: { id: string } | null }[] } } | null)[];
};

function isReviewNotFound(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND" && error.path?.[0] === "nodes";
}

// GitHub's most ids in one `nodes` lookup.
const IDS_PER_QUERY = 100;

// A review that only comments, with no body, might only hold replies.
function mightOnlyReply(review: AssignedNode["reviews"]["nodes"][number]): boolean {
  return review.state === "COMMENTED" && review.body === "";
}

// Makes each review in `activity` that might only hold replies a reply when
// it has inline comments and all of them reply to existing threads, opening
// the first one. The rest stay reviews.
async function withReplies(
  github: GitHubClient,
  activity: Activity[],
  mightBeReplies: ReadonlySet<string>,
): Promise<Activity[]> {
  const ids = activity.filter((item) => mightBeReplies.has(item.id)).map((item) => item.id);
  const firstReply = new Map<string, string>();
  for (let start = 0; start < ids.length; start += IDS_PER_QUERY) {
    const data = dataOf<RepliesData>(
      await github.graphql(REPLIES_QUERY, { ids: ids.slice(start, start + IDS_PER_QUERY) }),
      isReviewNotFound,
    );
    if (data?.nodes === undefined) throw new Error("GitHub GraphQL response has no reviews");
    for (const review of data.nodes) {
      const first = review?.comments.nodes[0];
      if (first !== undefined && review?.comments.nodes.every((comment) => comment.replyTo !== null)) {
        firstReply.set(review.id, first.url);
      }
    }
  }
  return activity.map((item) => {
    const url = firstReply.get(item.id);
    return url === undefined ? item : { ...item, kind: "reply", url };
  });
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

export type CheckedPRs = {
  assignedPRs: AssignedPR[];
  reviewInbox: ReviewInboxPR[];
};

// What a check saw: its PRs, what each PR it looked up looks like now, and
// the new activity on its Assigned PRs.
export type Checked = CheckedPRs & {
  tracked: TrackedPR[];
  activity: Activity[];
};

export type FetchOptions = {
  // PRs to look up by their repository and number, in the first query only.
  lookups?: PRRef[];
  // Activity counts as new only after `since`, and never without it.
  since?: string;
  // Ids of activity already seen, which is never new again.
  known?: ReadonlySet<string>;
};

export async function fetchPRs(
  github: GitHubClient,
  { lookups = [], since, known = new Set() }: FetchOptions = {},
): Promise<Checked> {
  const assigned: AssignedNode[] = [];
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
        ...issueVariables(looking),
      }),
    );
    viewer = data.viewer.login;
    tracked ??= looking.map((ref, i) => trackedPR(ref, data[`tracked${i}`], viewer));
    if (withAssigned) follow(assignedPaging, data.assigned, assigned);
    if (withInbox) follow(inboxPaging, data.inbox, inbox);
  }
  const open = (node: PRNode) => node.state === "OPEN";
  const openAssigned = assigned.filter(open);
  return {
    assignedPRs: openAssigned.map(assignedPR),
    reviewInbox: inbox
      .filter(open)
      .map((node) => reviewInboxPR(node, viewer))
      .filter((pr) => pr !== undefined),
    tracked: tracked ?? [],
    activity:
      since === undefined
        ? []
        : await withReplies(
            github,
            openAssigned.flatMap((node) => newActivity(node, viewer, since, known)),
            new Set(openAssigned.flatMap((node) => node.reviews.nodes.filter(mightOnlyReply).map((review) => review.id))),
          ),
  };
}
