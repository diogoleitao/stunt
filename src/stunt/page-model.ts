import type { State } from "../data/store.ts";
import type { AssignedPR, Review } from "../github/assigned-prs.ts";

export type ReviewStatus = "review required" | "approved" | "changes requested";

export type AssignedPRRow = {
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  reviewStatus: ReviewStatus;
  updatedAgo: string;
  // Each reviewer's latest review, most recent first.
  reviews: ReviewRow[];
  // Who a review is still requested from: user logins and team slugs.
  pendingReviewers: string[];
};

export type ReviewRow = {
  reviewer: string;
  state: "approved" | "changes requested" | "commented" | "dismissed";
  submittedAgo: string;
};

const REVIEW_STATES = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
} as const satisfies Record<Review["state"], ReviewRow["state"]>;

export type RepositoryModel = {
  name: string;
  assignedPRs: AssignedPRRow[];
};

export type PageModel = {
  checkedAt?: string;
  repositories: RepositoryModel[];
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

const relative = new Intl.RelativeTimeFormat("en", { numeric: "always" });

// The time since `then`, in its largest whole unit, such as "3 hours ago".
function timeAgo(then: string, now: Date): string {
  const seconds = Math.max(0, (now.getTime() - Date.parse(then)) / 1000);
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return "just now";
}

const DECISIONS = {
  REVIEW_REQUIRED: "review required",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes requested",
} as const satisfies Record<NonNullable<AssignedPR["reviewDecision"]>, ReviewStatus>;

// A verdict is a review that approves or requests changes.
function isVerdict(review: Review): boolean {
  return review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
}

// Each reviewer's standing review, the PR's author left out: their latest
// review, except that a comment never replaces a verdict. A dismissed verdict
// is no longer one, and GitHub keeps its submission time, so a comment after
// it stands whether it came before or after the dismissal.
function standingReviews(pr: AssignedPR): Review[] {
  const standing = new Map<string, Review>();
  for (const review of pr.reviews) {
    if (review.author === pr.author) continue;
    const current = standing.get(review.author);
    if (review.state === "COMMENTED" && current !== undefined && isVerdict(current)) continue;
    standing.set(review.author, review);
  }
  return [...standing.values()];
}

// GitHub's review decision when it reports one. Otherwise any reviewer
// requesting changes gives changes requested, else any approval gives
// approved, else review required.
function reviewStatus(pr: AssignedPR, reviews: Review[]): ReviewStatus {
  if (pr.reviewDecision !== null) return DECISIONS[pr.reviewDecision];
  const states = new Set(reviews.map((review) => review.state));
  if (states.has("CHANGES_REQUESTED")) return "changes requested";
  if (states.has("APPROVED")) return "approved";
  return "review required";
}

export function pageModel(state: State, now: Date): PageModel {
  const byRepository = new Map<string, State["assignedPRs"]>();
  for (const pr of state.assignedPRs) {
    byRepository.set(pr.repository, [...(byRepository.get(pr.repository) ?? []), pr]);
  }

  const repositories = [...byRepository.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, prs]) => ({
      name,
      assignedPRs: prs
        .toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
        .map((pr) => {
          const reviews = standingReviews(pr);
          return {
            number: pr.number,
            title: pr.title,
            url: pr.url,
            author: pr.author,
            draft: pr.draft,
            reviewStatus: reviewStatus(pr, reviews),
            updatedAgo: timeAgo(pr.updatedAt, now),
            reviews: reviews
              .toSorted((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
              .map((review) => ({
                reviewer: review.author,
                state: REVIEW_STATES[review.state],
                submittedAgo: timeAgo(review.submittedAt, now),
              })),
            pendingReviewers: pr.pendingReviewers,
          };
        }),
    }));

  return { checkedAt: state.checkedAt, repositories };
}
