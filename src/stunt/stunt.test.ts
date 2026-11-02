import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client.ts";
import { openStunt } from "./stunt.ts";
// Recorded from the real query against a live account, then stripped of
// logins, owners, repository names, and titles. The two Assigned PR pages
// were recorded with a page size of 5. The Review inbox was recorded apart,
// with the viewer, by a later version of the query that also asks for it.
import assignedFull from "./fixtures/assigned-prs-full.json" with { type: "json" };
import assignedPage1 from "./fixtures/assigned-prs-page-1.json" with { type: "json" };
import assignedPage2 from "./fixtures/assigned-prs-page-2.json" with { type: "json" };
import inboxFull from "./fixtures/review-inbox.json" with { type: "json" };

const NOW = new Date("2026-11-01T12:00:00Z");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stunt-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type GraphQLCall = { query: string; variables: Record<string, unknown> };

// A response body, or a function giving the body for a query's variables.
type Response = unknown | ((variables: Record<string, unknown>) => unknown);

// Replays recorded response bodies in order, one per query.
function fakeGitHub(responses: Response[]): GitHubClient & { calls: GraphQLCall[] } {
  const queue = [...responses];
  const calls: GraphQLCall[] = [];
  return {
    calls,
    async graphql(query, variables) {
      calls.push({ query, variables });
      if (queue.length === 0) throw new Error("no recorded response left");
      const response = queue.shift();
      return structuredClone(typeof response === "function" ? response(variables) : response);
    },
  };
}

function configPath() {
  return path.join(dir, "config", "config.json");
}

function stunt(github: GitHubClient, now = NOW) {
  return openStunt({
    github,
    dataDir: path.join(dir, "data"),
    configPath: configPath(),
    clock: { now: () => now },
  });
}

// What the app keeps on disk.
async function storedState() {
  return JSON.parse(await readFile(path.join(dir, "data", "state.json"), "utf8"));
}

async function writeConfig(config: unknown) {
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config));
}

type Recorded = { data: object };

// The recorded Review inbox, emptied, for checks about Assigned PRs alone.
const NO_INBOX = { data: { ...inboxFull.data, inbox: { ...inboxFull.data.inbox, nodes: [] } } };

type RecordedInboxPR = (typeof inboxFull)["data"]["inbox"]["nodes"][number];

// One check's response: recorded Assigned PRs and a recorded Review inbox,
// which were recorded apart. A check also looks up each PR with open Tasks by
// its owner, name, and number; the lookup answers with the PR from `tracked`,
// else from the Review inbox.
function checkResponse(assigned: Recorded, inbox: Recorded = NO_INBOX, tracked: RecordedInboxPR[] = []) {
  return (variables: Record<string, unknown>) => {
    const data: Record<string, unknown> = { ...assigned.data, ...inbox.data };
    const nodes = [...tracked, ...((inbox.data as Partial<typeof inboxFull.data>).inbox?.nodes ?? [])];
    for (let i = 0; `owner${i}` in variables; i++) {
      const name = `${variables[`owner${i}`]}/${variables[`name${i}`]}`;
      const pr = nodes.find((node) => node.repository.nameWithOwner === name && node.number === variables[`number${i}`]);
      if (pr === undefined) throw new Error(`no recorded PR to look up for ${name}#${variables[`number${i}`]}`);
      data[`tracked${i}`] = { pullRequest: pr };
    }
    return { data };
  };
}

// The recorded full response, without the PRs that were merged or closed.
function withoutPRs(...numbers: number[]) {
  const response = structuredClone(assignedFull);
  response.data.assigned.nodes = response.data.assigned.nodes.filter(
    (node) => !numbers.includes(node.number),
  );
  return response;
}

type RecordedPR = (typeof assignedFull)["data"]["assigned"]["nodes"][number];

// The recorded full response, with PR `number` changed by `change`.
function withPR(number: number, change: (pr: RecordedPR) => void) {
  const response = structuredClone(assignedFull);
  const pr = response.data.assigned.nodes.find((node) => node.number === number);
  if (pr === undefined) throw new Error(`no recorded PR #${number}`);
  change(pr);
  return response;
}

// The recorded Review inbox, with PR `number` changed by `change`.
function withInboxPR(number: number, change: (pr: RecordedInboxPR) => void) {
  const response = structuredClone(inboxFull);
  const pr = response.data.inbox.nodes.find((node) => node.number === number);
  if (pr === undefined) throw new Error(`no recorded Review inbox PR #${number}`);
  change(pr);
  return response;
}

// Recorded Review inbox PR `number`, changed by `change`.
function inboxPR(number: number, change: (pr: RecordedInboxPR) => void = () => {}) {
  const pr = structuredClone(inboxFull.data.inbox.nodes.find((node) => node.number === number));
  if (pr === undefined) throw new Error(`no recorded Review inbox PR #${number}`);
  change(pr);
  return pr;
}

// The recorded Review inbox, without the PRs the search no longer returns.
function inboxWithout(...numbers: number[]) {
  const response = structuredClone(inboxFull);
  response.data.inbox.nodes = response.data.inbox.nodes.filter((node) => !numbers.includes(node.number));
  return response;
}

// Takes my pending Review request off a recorded Review inbox PR.
function withoutMyRequest(pr: RecordedInboxPR) {
  pr.reviewRequests.nodes = pr.reviewRequests.nodes.filter((node) => node.requestedReviewer.login !== "user-1");
}

// A review as GitHub's GraphQL API returns it.
function review(login: string, state: string, submittedAt: string) {
  return { state, submittedAt, author: { login } };
}

// A Review request event as GitHub's GraphQL API returns it.
function requested(actor: string, reviewer: string, createdAt: string) {
  return { createdAt, actor: { login: actor }, requestedReviewer: { __typename: "User", login: reviewer } };
}

// The Assigned PR row for PR `number` after one check returning the Assigned
// PRs in `assigned`.
async function rowOf(assigned: Recorded, number: number) {
  const row = (await modelOf(checkResponse(assigned))).repositories
    .flatMap((repository) => repository.assignedPRs)
    .find((pr) => pr.number === number);
  if (row === undefined) throw new Error(`no Assigned PR row for #${number}`);
  return row;
}

// The Review inbox of `repository` after one check returning the Review inbox
// in `inbox`.
async function inboxOf(inbox: Recorded, repository: string) {
  return inboxRows(await modelOf(checkResponse(assignedFull, inbox)), repository);
}

// The Review inbox rows of `repository` in `model`.
function inboxRows(model: Awaited<ReturnType<typeof modelOf>>, repository: string) {
  return model.repositories.find((candidate) => candidate.name === repository)?.reviewInbox ?? [];
}

// The page model after one check returning `response`.
async function modelOf(response: unknown) {
  const reference = openStunt({
    github: fakeGitHub([response]),
    dataDir: path.join(dir, "reference"),
    configPath: configPath(),
    clock: { now: () => NOW },
  });
  await reference.check();
  return reference.pageModel();
}

// The page model after one check of assigned-prs-full.json at NOW.
const ALL_ASSIGNED = {
  checkedAt: "2026-11-01T12:00:00.000Z",
  repositories: [
    {
      name: "owner-1/repo-1",
      tasks: [],
      reviewInbox: [],
      assignedPRs: [
        {
          number: 136,
          title: "Assigned PR 1",
          url: "https://github.com/owner-1/repo-1/pull/136",
          author: "user-1",
          draft: false,
          reviewStatus: "changes requested",
          updatedAgo: "15 days ago",
          reviews: [{ reviewer: "user-2", state: "changes requested", submittedAgo: "2 months ago" }],
          pendingReviewers:[],
        },
      ],
    },
    {
      name: "owner-1/repo-2",
      tasks: [],
      reviewInbox: [],
      assignedPRs: [
        {
          number: 10420,
          title: "Assigned PR 3",
          url: "https://github.com/owner-1/repo-2/pull/10420",
          author: "user-1",
          draft: false,
          reviewStatus: "review required",
          updatedAgo: "1 day ago",
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "1 day ago" }],
          pendingReviewers:[],
        },
        {
          number: 10412,
          title: "Assigned PR 2",
          url: "https://github.com/owner-1/repo-2/pull/10412",
          author: "user-1",
          draft: false,
          reviewStatus: "review required",
          updatedAgo: "2 days ago",
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "2 days ago" }],
          pendingReviewers:["user-2"],
        },
        {
          number: 9968,
          title: "Assigned PR 4",
          url: "https://github.com/owner-1/repo-2/pull/9968",
          author: "user-1",
          draft: false,
          reviewStatus: "changes requested",
          updatedAgo: "15 days ago",
          reviews: [
            { reviewer: "user-2", state: "changes requested", submittedAgo: "1 month ago" },
            { reviewer: "user-3", state: "approved", submittedAgo: "1 month ago" },
          ],
          pendingReviewers:[],
        },
      ],
    },
    {
      name: "owner-1/repo-3",
      tasks: [],
      reviewInbox: [],
      assignedPRs: [
        // Assigned PRs include drafts.
        {
          number: 381,
          title: "Assigned PR 5",
          url: "https://github.com/owner-1/repo-3/pull/381",
          author: "user-1",
          draft: true,
          reviewStatus: "review required",
          updatedAgo: "5 days ago",
          reviews: [],
          pendingReviewers:[],
        },
      ],
    },
    {
      name: "owner-2/repo-4",
      tasks: [],
      reviewInbox: [],
      assignedPRs: [
        {
          number: 28,
          title: "Assigned PR 8",
          url: "https://github.com/owner-2/repo-4/pull/28",
          author: "user-1",
          draft: false,
          reviewStatus: "review required",
          updatedAgo: "18 hours ago",
          reviews: [],
          pendingReviewers:["user-2"],
        },
        {
          number: 27,
          title: "Assigned PR 7",
          url: "https://github.com/owner-2/repo-4/pull/27",
          author: "user-1",
          draft: false,
          reviewStatus: "review required",
          updatedAgo: "19 hours ago",
          reviews: [],
          pendingReviewers:["user-2"],
        },
        {
          number: 25,
          title: "Assigned PR 6",
          url: "https://github.com/owner-2/repo-4/pull/25",
          author: "user-1",
          draft: false,
          reviewStatus: "review required",
          updatedAgo: "20 hours ago",
          reviews: [{ reviewer: "user-2", state: "approved", submittedAgo: "21 hours ago" }],
          pendingReviewers:["user-2"],
        },
      ],
    },
  ],
};

describe("a check", () => {
  it("lists every repository with an Assigned PR, and its Assigned PRs, most recently updated first", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("makes one query when the first pages hold every Assigned PR and the whole Review inbox", async () => {
    const github = fakeGitHub([checkResponse(assignedFull, inboxFull)]);

    await stunt(github).check();

    expect(github.calls).toHaveLength(1);
    expect(github.calls[0].query).toContain("assignee:@me");
    expect(github.calls[0].query).toContain("user-review-requested:@me");
  });

  it("follows the next page of Assigned PRs alone when that page overflows", async () => {
    const github = fakeGitHub([
      checkResponse(assignedPage1),
      // A follow-up query asks for the viewer and the overflowing search only.
      checkResponse(assignedPage2, { data: { viewer: inboxFull.data.viewer } }),
    ]);
    const app = stunt(github);

    await app.check();

    expect(github.calls.map((call) => call.variables)).toMatchObject([
      { assigned: true, assignedAfter: null, inbox: true, inboxAfter: null },
      { assigned: true, assignedAfter: "Y3Vyc29yOjU=", inbox: false },
    ]);
    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("drops a PR merged or closed since the last check, and a repository left with none", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull), checkResponse(withoutPRs(10412, 136))]));

    await app.check();
    await app.check();

    const repositories = (await app.pageModel()).repositories;
    expect(repositories.map((repository) => repository.name)).toEqual([
      "owner-1/repo-2",
      "owner-1/repo-3",
      "owner-2/repo-4",
    ]);
    expect(repositories[0].assignedPRs.map((pr) => pr.number)).toEqual([10420, 9968]);
  });

  it("drops a PR the search still returns after it was merged or closed", async () => {
    const lagging = structuredClone(assignedFull);
    for (const node of lagging.data.assigned.nodes) {
      if (node.number === 10412) node.state = "MERGED";
      if (node.number === 136) node.state = "CLOSED";
    }
    const app = stunt(fakeGitHub([checkResponse(lagging)]));

    await app.check();

    expect(await app.pageModel()).toEqual(await modelOf(checkResponse(withoutPRs(10412, 136))));
  });

  it("keeps what the last check saw across restarts", async () => {
    await stunt(fakeGitHub([checkResponse(assignedFull)])).check();

    expect(await stunt(fakeGitHub([])).pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("shows nothing before the first check", async () => {
    expect(await stunt(fakeGitHub([])).pageModel()).toEqual({ repositories: [] });
  });

  it("keeps the last check's PRs when a check fails", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();
    await expect(app.check()).rejects.toThrow("no recorded response left");

    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });
});

describe("an Assigned PR row", () => {
  it("marks a draft", async () => {
    expect((await rowOf(assignedFull, 381)).draft).toBe(true);
    expect((await rowOf(assignedFull, 28)).draft).toBe(false);
  });

  it("holds every reviewer's latest review, most recent first, leaving out the PR's author", async () => {
    expect((await rowOf(assignedFull, 9968)).reviews).toEqual([
      { reviewer: "user-2", state: "changes requested", submittedAgo: "1 month ago" },
      { reviewer: "user-3", state: "approved", submittedAgo: "1 month ago" },
    ]);
    expect((await rowOf(assignedFull, 25)).reviews).toEqual([
      { reviewer: "user-2", state: "approved", submittedAgo: "21 hours ago" },
    ]);
    expect((await rowOf(assignedFull, 10412)).reviews).toEqual([
      { reviewer: "user-2", state: "commented", submittedAgo: "2 days ago" },
    ]);
    expect((await rowOf(assignedFull, 28)).reviews).toEqual([]);
  });

  it("holds a reviewer's verdict over their later comments, and never a pending review", async () => {
    const response = withPR(10420, (pr) => {
      pr.reviews.nodes = [
        review("user-2", "APPROVED", "2026-11-01T09:00:00Z"),
        review("user-3", "DISMISSED", "2026-11-01T09:30:00Z"),
        review("user-2", "COMMENTED", "2026-11-01T10:00:00Z"),
        { state: "PENDING", submittedAt: null, author: { login: "user-4" } },
      ] as RecordedPR["reviews"]["nodes"];
    });

    expect((await rowOf(response, 10420)).reviews).toEqual([
      { reviewer: "user-3", state: "dismissed", submittedAgo: "2 hours ago" },
      { reviewer: "user-2", state: "approved", submittedAgo: "3 hours ago" },
    ]);
  });

  // Dismissing a review changes its state in place, keeping when it was
  // submitted.
  it("holds a reviewer's later comment once their verdict was dismissed", async () => {
    const response = withPR(10420, (pr) => {
      pr.reviews.nodes = [
        review("user-2", "DISMISSED", "2026-11-01T09:00:00Z"),
        review("user-2", "COMMENTED", "2026-11-01T10:00:00Z"),
      ] as RecordedPR["reviews"]["nodes"];
    });

    const row = await rowOf(response, 10420);
    expect(row.reviews).toEqual([{ reviewer: "user-2", state: "commented", submittedAgo: "2 hours ago" }]);
    expect(row.reviewStatus).toBe("review required");
  });

  it("holds everyone a review is still requested from", async () => {
    expect((await rowOf(assignedFull, 28)).pendingReviewers).toEqual(["user-2"]);
    expect((await rowOf(assignedFull, 9968)).pendingReviewers).toEqual([]);
  });

  it("holds a team a review is still requested from by its slug", async () => {
    const response = withPR(28, (pr) => {
      (pr.reviewRequests.nodes as unknown[]).push({
        requestedReviewer: { __typename: "Team", combinedSlug: "owner-2/team-1" },
      });
    });

    expect((await rowOf(response, 28)).pendingReviewers).toEqual(["user-2", "owner-2/team-1"]);
  });
});

describe("an Assigned PR's Review status", () => {
  it.each([
    [28, "review required"],
    [9968, "changes requested"],
    [136, "changes requested"],
  ])("is GitHub's review decision when GitHub reports one (#%i)", async (number, reviewStatus) => {
    expect((await rowOf(assignedFull, number)).reviewStatus).toBe(reviewStatus);
  });

  it("is approved when GitHub's review decision is approved, whatever the reviews say", async () => {
    const approved = withPR(9968, (pr) => {
      pr.reviewDecision = "APPROVED";
    });

    expect((await rowOf(approved, 9968)).reviewStatus).toBe("approved");
  });

  // #10420 was recorded without a review decision.
  it.each([
    [
      "changes requested when any reviewer's latest verdict requests changes",
      [review("user-2", "APPROVED", "2026-10-30T10:00:00Z"), review("user-3", "CHANGES_REQUESTED", "2026-10-30T11:00:00Z")],
      "changes requested",
    ],
    [
      "approved when a reviewer approves after requesting changes",
      [review("user-2", "CHANGES_REQUESTED", "2026-10-30T10:00:00Z"), review("user-2", "APPROVED", "2026-10-30T11:00:00Z")],
      "approved",
    ],
    [
      "approved when a reviewer comments after approving",
      [review("user-2", "APPROVED", "2026-10-30T10:00:00Z"), review("user-2", "COMMENTED", "2026-10-30T11:00:00Z")],
      "approved",
    ],
    [
      "changes requested when a reviewer comments after requesting changes, despite another's approval",
      [
        review("user-2", "CHANGES_REQUESTED", "2026-10-30T10:00:00Z"),
        review("user-3", "APPROVED", "2026-10-30T11:00:00Z"),
        review("user-2", "COMMENTED", "2026-10-30T12:00:00Z"),
      ],
      "changes requested",
    ],
    [
      "review required when the only approval was dismissed",
      [review("user-2", "DISMISSED", "2026-10-30T10:00:00Z"), review("user-3", "COMMENTED", "2026-10-30T11:00:00Z")],
      "review required",
    ],
    [
      "approved when a pending review follows an approval",
      [review("user-3", "APPROVED", "2026-10-30T10:00:00Z"), { state: "PENDING", submittedAt: null, author: { login: "user-3" } }],
      "approved",
    ],
  ])("without GitHub's review decision, is %s", async (_, reviews, reviewStatus) => {
    const response = withPR(10420, (pr) => {
      pr.reviews.nodes = reviews as RecordedPR["reviews"]["nodes"];
    });

    expect((await rowOf(response, 10420)).reviewStatus).toBe(reviewStatus);
  });

  it.each([
    ["only comments", 10412],
    ["no reviews", 381],
  ])("without GitHub's review decision, is review required with %s", async (_, number) => {
    expect((await rowOf(assignedFull, number)).reviewStatus).toBe("review required");
  });
});

describe("the Review inbox", () => {
  it("lists every open PR with a Review request pending for me, oldest request first", async () => {
    expect(await inboxOf(inboxFull, "owner-1/repo-2")).toEqual([
      {
        number: 10255,
        title: "Review inbox PR 13",
        url: "https://github.com/owner-1/repo-2/pull/10255",
        author: "user-2",
        request: { by: "user-2", ago: "5 days ago" },
        reRequest: false,
      },
      {
        number: 10306,
        title: "Review inbox PR 11",
        url: "https://github.com/owner-1/repo-2/pull/10306",
        author: "user-2",
        request: { by: "user-2", ago: "5 days ago" },
        reRequest: false,
      },
      // Requested three times; I reviewed between the first and the second.
      {
        number: 10404,
        title: "Review inbox PR 5",
        url: "https://github.com/owner-1/repo-2/pull/10404",
        author: "user-3",
        request: { by: "user-3", ago: "2 days ago" },
        reRequest: true,
      },
      {
        number: 10419,
        title: "Review inbox PR 1",
        url: "https://github.com/owner-1/repo-2/pull/10419",
        author: "user-5",
        request: { by: "user-5", ago: "1 day ago" },
        reRequest: false,
      },
    ]);
  });

  it("ignores a Review request on a draft, and lists the PR once it is marked ready", async () => {
    const draft = withInboxPR(10419, (pr) => {
      pr.isDraft = true;
    });
    const app = stunt(fakeGitHub([checkResponse(assignedFull, draft), checkResponse(assignedFull, inboxFull)]));

    await app.check();
    expect(inboxRows(await app.pageModel(), "owner-1/repo-2").map((pr) => pr.number)).toEqual([
      10255, 10306, 10404,
    ]);

    await app.check();
    expect(inboxRows(await app.pageModel(), "owner-1/repo-2").map((pr) => pr.number)).toEqual([
      10255, 10306, 10404, 10419,
    ]);
  });

  it("orders every PR by its latest request, oldest first, marking those I reviewed before it", async () => {
    expect(
      (await inboxOf(inboxFull, "owner-1/repo-5")).map(({ number, reRequest }) => ({ number, reRequest })),
    ).toEqual([
      { number: 362, reRequest: false },
      { number: 353, reRequest: true },
      { number: 363, reRequest: false },
      { number: 364, reRequest: false },
      { number: 365, reRequest: false },
      { number: 264, reRequest: true },
      { number: 278, reRequest: true },
      { number: 293, reRequest: true },
      // Its earlier requests are gone from GitHub, but my review is not.
      { number: 321, reRequest: true },
      { number: 345, reRequest: false },
      { number: 348, reRequest: true },
      { number: 359, reRequest: false },
    ]);
  });

  // GitHub clears my Review request when I submit a review.
  it.each([["APPROVED"], ["CHANGES_REQUESTED"], ["COMMENTED"]])(
    "drops a PR once I submit a review (%s)",
    async (state) => {
      const reviewed = withInboxPR(10419, (pr) => {
        withoutMyRequest(pr);
        (pr.reviews.nodes as unknown[]).push(review("user-1", state, "2026-11-01T11:00:00Z"));
      });

      expect((await inboxOf(reviewed, "owner-1/repo-2")).map((pr) => pr.number)).toEqual([10255, 10306, 10404]);
    },
  );

  it("keeps a PR while my review of it is a pending draft", async () => {
    const drafting = withInboxPR(10419, (pr) => {
      (pr.reviews.nodes as unknown[]).push({ state: "PENDING", submittedAt: null, author: { login: "user-1" } });
    });

    const rows = await inboxOf(drafting, "owner-1/repo-2");
    expect(rows.map(({ number, reRequest }) => ({ number, reRequest }))).toContainEqual({
      number: 10419,
      reRequest: false,
    });
  });

  it("lists a PR again, marked as a re-request, when my review is requested again", async () => {
    const reviewed = withInboxPR(10419, (pr) => {
      withoutMyRequest(pr);
      (pr.reviews.nodes as unknown[]).push(review("user-1", "COMMENTED", "2026-11-01T09:00:00Z"));
    });
    const reRequested = withInboxPR(10419, (pr) => {
      (pr.reviews.nodes as unknown[]).push(review("user-1", "COMMENTED", "2026-11-01T09:00:00Z"));
      pr.timelineItems.nodes.push(requested("user-5", "user-1", "2026-11-01T10:00:00Z"));
    });
    const app = stunt(
      fakeGitHub([
        checkResponse(assignedFull, inboxFull),
        checkResponse(assignedFull, reviewed),
        checkResponse(assignedFull, reRequested),
      ]),
    );

    await app.check();
    await app.check();
    expect(inboxRows(await app.pageModel(), "owner-1/repo-2").map((pr) => pr.number)).not.toContain(10419);

    await app.check();
    expect(inboxRows(await app.pageModel(), "owner-1/repo-2").at(-1)).toEqual({
      number: 10419,
      title: "Review inbox PR 1",
      url: "https://github.com/owner-1/repo-2/pull/10419",
      author: "user-5",
      request: { by: "user-5", ago: "2 hours ago" },
      reRequest: true,
    });
  });

  // The search index lags behind withdrawn requests.
  it("drops a PR whose Review request was withdrawn, though the search still returns it", async () => {
    const withdrawn = withInboxPR(10419, withoutMyRequest);

    expect((await inboxOf(withdrawn, "owner-1/repo-2")).map((pr) => pr.number)).toEqual([10255, 10306, 10404]);
  });

  it("ignores a Review request made to a team of mine rather than to me", async () => {
    const toTeam = withInboxPR(10419, (pr) => {
      withoutMyRequest(pr);
      (pr.reviewRequests.nodes as unknown[]).push({
        requestedReviewer: { __typename: "Team", combinedSlug: "owner-1/team-1" },
      });
    });

    expect((await inboxOf(toTeam, "owner-1/repo-2")).map((pr) => pr.number)).toEqual([10255, 10306, 10404]);
  });

  it("drops a PR the search still returns after it was merged or closed", async () => {
    const lagging = structuredClone(inboxFull);
    for (const node of lagging.data.inbox.nodes) {
      if (node.number === 10419) node.state = "MERGED";
      if (node.number === 10404) node.state = "CLOSED";
    }

    expect((await inboxOf(lagging, "owner-1/repo-2")).map((pr) => pr.number)).toEqual([10255, 10306]);
  });

  it("puts a repository with only Review inbox PRs in the sidebar", async () => {
    const model = await modelOf(checkResponse(assignedFull, inboxFull));

    expect(model.repositories.map((repository) => repository.name)).toEqual([
      "owner-1/repo-1",
      "owner-1/repo-2",
      "owner-1/repo-3",
      "owner-1/repo-5",
      "owner-2/repo-4",
    ]);
    expect(model.repositories[3].assignedPRs).toEqual([]);
  });

  it("follows the next page of the Review inbox alone when that page overflows", async () => {
    // The recorded Review inbox, split into a first page of 5 and the rest.
    const page1 = structuredClone(inboxFull);
    page1.data.inbox.nodes = inboxFull.data.inbox.nodes.slice(0, 5);
    page1.data.inbox.pageInfo = { hasNextPage: true, endCursor: "Y3Vyc29yOjU=" };
    const page2 = { data: { viewer: inboxFull.data.viewer, inbox: { ...inboxFull.data.inbox, nodes: inboxFull.data.inbox.nodes.slice(5) } } };
    const github = fakeGitHub([checkResponse(assignedFull, page1), page2]);
    const app = stunt(github);

    await app.check();

    expect(github.calls.map((call) => call.variables)).toMatchObject([
      { assigned: true, assignedAfter: null, inbox: true, inboxAfter: null },
      { assigned: false, inbox: true, inboxAfter: "Y3Vyc29yOjU=" },
    ]);
    expect(await app.pageModel()).toEqual(await modelOf(checkResponse(assignedFull, inboxFull)));
  });

  it("counts a request made while the PR was a draft from when the PR was marked ready", async () => {
    const readyLater = withInboxPR(10255, (pr) => {
      (pr.readyEvents.nodes as unknown[]).push({ createdAt: "2026-11-01T08:00:00Z" });
    });

    const rows = await inboxOf(readyLater, "owner-1/repo-2");
    expect(rows.map((pr) => pr.number)).toEqual([10306, 10404, 10419, 10255]);
    expect(rows[3].request).toEqual({ by: "user-2", ago: "4 hours ago" });
  });

  // The query reads the last 100 Review request events of each PR.
  it("lists a request older than the events it reads first, with no requester or time", async () => {
    const response = withInboxPR(10419, (pr) => {
      pr.timelineItems.nodes = pr.timelineItems.nodes.filter((event) => event.requestedReviewer.login !== "user-1");
    });

    expect((await inboxOf(response, "owner-1/repo-2"))[0]).toEqual({
      number: 10419,
      title: "Review inbox PR 1",
      url: "https://github.com/owner-1/repo-2/pull/10419",
      author: "user-5",
      request: null,
      reRequest: false,
    });
  });
});

// The open Tasks of `repository` in `model`, grouped by PR.
function tasksOf(model: Awaited<ReturnType<typeof modelOf>>, repository: string) {
  return model.repositories.find((candidate) => candidate.name === repository)?.tasks ?? [];
}

describe("Review request Tasks", () => {
  it("makes each Review request pending at the first check an open Task, grouped by PR, oldest first", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]));

    await app.check();

    const model = await app.pageModel();
    expect(tasksOf(model, "owner-1/repo-3")).toEqual([
      {
        number: 368,
        title: "Review inbox PR 12",
        url: "https://github.com/owner-1/repo-3/pull/368",
        tasks: [
          {
            id: expect.any(String),
            kind: "review request",
            // Opens the PR's Files changed tab.
            url: "https://github.com/owner-1/repo-3/pull/368/files",
            by: "user-2",
            ago: "5 days ago",
          },
        ],
      },
    ]);
    expect(tasksOf(model, "owner-1/repo-2").map((pr) => pr.number)).toEqual([10255, 10306, 10404, 10419]);
  });

  it("records the Baseline at the first check, and never resets it at later checks or restarts", async () => {
    await stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)])).check();
    await stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]), new Date("2026-11-02T12:00:00Z")).check();

    expect(await storedState()).toMatchObject({
      baseline: "2026-11-01T12:00:00.000Z",
      checkedAt: "2026-11-02T12:00:00.000Z",
    });
  });

  it("makes a Review request a Task once, across checks and restarts", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, inboxFull)]));
    await app.check();
    await app.check();
    const restarted = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]), new Date("2026-11-02T12:00:00Z"));
    await restarted.check();

    const model = await restarted.pageModel();
    expect(tasksOf(model, "owner-1/repo-3").map((pr) => pr.tasks.length)).toEqual([1]);
    expect(model.repositories.flatMap((repository) => repository.tasks.flatMap((pr) => pr.tasks))).toHaveLength(17);
  });

  it("looks up every PR with open Tasks at each check, whether or not the search returns it", async () => {
    const reviewed = inboxPR(368, (pr) => {
      withoutMyRequest(pr);
      (pr.reviews.nodes as unknown[]).push(review("user-1", "APPROVED", "2026-11-01T11:00:00Z"));
    });
    const github = fakeGitHub([
      checkResponse(assignedFull, inboxFull),
      checkResponse(assignedFull, inboxWithout(368), [reviewed]),
      checkResponse(assignedFull, inboxWithout(368)),
    ]);
    const app = stunt(github);

    await app.check();
    await app.check();
    await app.check();

    // Each lookup as owner/name#number.
    const lookups = github.calls.map(({ variables }) =>
      Object.keys(variables)
        .filter((key) => /^owner\d+$/.test(key))
        .map((key) => key.slice("owner".length))
        .map((i) => `${variables[`owner${i}`]}/${variables[`name${i}`]}#${variables[`number${i}`]}`),
    );
    expect(lookups[0]).toEqual([]);
    expect(lookups[1]).toHaveLength(17);
    expect(lookups[1]).toContain("owner-1/repo-3#368");
    // #368's only Task is done.
    expect(lookups[2]).toHaveLength(16);
    expect(lookups[2]).not.toContain("owner-1/repo-3#368");
  });

  // GitHub clears my Review request when I submit a review, and the search
  // stops returning the PR.
  it.each([["APPROVED"], ["CHANGES_REQUESTED"], ["COMMENTED"]])(
    "is done once I submit a review after the request (%s)",
    async (state) => {
      const reviewed = inboxPR(368, (pr) => {
        withoutMyRequest(pr);
        (pr.reviews.nodes as unknown[]).push(review("user-1", state, "2026-11-01T11:00:00Z"));
      });
      const app = stunt(
        fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, inboxWithout(368), [reviewed])]),
      );

      await app.check();
      await app.check();

      expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);
    },
  );

  it("makes a re-request a new Task, the earlier one done by my review", async () => {
    const reRequested = withInboxPR(368, (pr) => {
      (pr.reviews.nodes as unknown[]).push(review("user-1", "COMMENTED", "2026-11-01T11:00:00Z"));
      pr.timelineItems.nodes.push(requested("user-2", "user-1", "2026-11-01T11:30:00Z"));
    });
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, reRequested)]));

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")[0].tasks).toEqual([
      expect.objectContaining({ by: "user-2", ago: "30 minutes ago" }),
    ]);
  });

  it("ignores a Review request on a draft, and makes it a Task once the PR is marked ready", async () => {
    const draft = withInboxPR(368, (pr) => {
      pr.isDraft = true;
    });
    const app = stunt(fakeGitHub([checkResponse(assignedFull, draft), checkResponse(assignedFull, inboxFull)]));

    await app.check();
    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);

    await app.check();
    expect(tasksOf(await app.pageModel(), "owner-1/repo-3").map((pr) => pr.number)).toEqual([368]);
  });

  it("ignores a Review request made to a team of mine rather than to me", async () => {
    const toTeam = withInboxPR(368, (pr) => {
      withoutMyRequest(pr);
      (pr.reviewRequests.nodes as unknown[]).push({
        requestedReviewer: { __typename: "Team", combinedSlug: "owner-1/team-1" },
      });
    });

    expect(tasksOf(await modelOf(checkResponse(assignedFull, toTeam)), "owner-1/repo-3")).toEqual([]);
  });

  it("expires once the request is withdrawn", async () => {
    const withdrawn = inboxPR(368, withoutMyRequest);
    const app = stunt(
      fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, inboxWithout(368), [withdrawn])]),
    );

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);
  });

  it("expires when the request is withdrawn and made again between checks, the new request a new Task", async () => {
    const requestedAgain = withInboxPR(368, (pr) => {
      pr.timelineItems.nodes.push(requested("user-2", "user-1", "2026-11-01T11:30:00Z"));
    });
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, requestedAgain)]));

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")[0].tasks).toEqual([
      expect.objectContaining({ by: "user-2", ago: "30 minutes ago" }),
    ]);
  });

  it.each([["MERGED"], ["CLOSED"]])("expires when its PR is %s, though the search no longer returns it", async (state) => {
    const ended = inboxPR(368, (pr) => {
      pr.state = state;
    });
    const app = stunt(
      fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, inboxWithout(368), [ended])]),
    );

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);
  });

  it("expires when GitHub no longer finds its PR", async () => {
    const gone = (variables: Record<string, unknown>) => {
      const { data } = checkResponse(assignedFull, inboxWithout(368), [inboxPR(368)])(variables);
      const i = Object.keys(variables)
        .find((key) => key.startsWith("number") && variables[key] === 368)
        ?.slice("number".length);
      data[`tracked${i}`] = null;
      const message = "Could not resolve to a Repository with the name 'owner-1/repo-3'.";
      return { data, errors: [{ type: "NOT_FOUND", path: [`tracked${i}`], message }] };
    };
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), gone]));

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);
  });

  it("fails a check on any other GitHub error", async () => {
    const failing = { data: null, errors: [{ type: "NOT_FOUND", path: ["viewer"], message: "Not found" }] };

    await expect(stunt(fakeGitHub([failing])).check()).rejects.toThrow("GitHub GraphQL query failed: Not found");
  });

  it("is hidden once marked done, and stays done at later checks and restarts", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, inboxFull)]));
    await app.check();
    const [task] = tasksOf(await app.pageModel(), "owner-1/repo-3")[0].tasks;

    await app.markDone(task.id);
    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);

    await app.check();
    const restarted = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]));
    await restarted.check();
    const model = await restarted.pageModel();
    expect(tasksOf(model, "owner-1/repo-3")).toEqual([]);
    expect(tasksOf(model, "owner-1/repo-2").map((pr) => pr.number)).toEqual([10255, 10306, 10404, 10419]);
  });

  it("keeps a Task marked done while a check was asking GitHub", async () => {
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]));
    await app.check();
    const [task] = tasksOf(await app.pageModel(), "owner-1/repo-3")[0].tasks;
    const { promise: asked, resolve: ask } = Promise.withResolvers<void>();
    const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
    const github = fakeGitHub([checkResponse(assignedFull, inboxFull)]);
    const checking = stunt({
      async graphql(query, variables) {
        ask();
        await answered;
        return github.graphql(query, variables);
      },
    }).check();

    await asked;
    await app.markDone(task.id);
    answer();
    await checking;

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3")).toEqual([]);
  });

  // GitHub keeps my Review request when the PR goes back to draft.
  it("keeps a repository with only open Tasks in the sidebar", async () => {
    const backToDraft = inboxPR(368, (pr) => {
      pr.isDraft = true;
    });
    const app = stunt(
      fakeGitHub([
        checkResponse(assignedFull, inboxFull),
        checkResponse(withoutPRs(381), inboxWithout(368), [backToDraft]),
      ]),
    );

    await app.check();
    await app.check();

    const repository = (await app.pageModel()).repositories.find((candidate) => candidate.name === "owner-1/repo-3");
    expect(repository).toMatchObject({ assignedPRs: [], reviewInbox: [] });
    expect(repository?.tasks.map((pr) => pr.number)).toEqual([368]);
  });

  it("stays open while my review is a pending draft", async () => {
    const drafting = withInboxPR(368, (pr) => {
      (pr.reviews.nodes as unknown[]).push({ state: "PENDING", submittedAt: null, author: { login: "user-1" } });
    });
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull), checkResponse(assignedFull, drafting)]));

    await app.check();
    await app.check();

    expect(tasksOf(await app.pageModel(), "owner-1/repo-3").map((pr) => pr.number)).toEqual([368]);
  });
});

describe("checking on a schedule", () => {
  beforeEach(() => {
    // Only the schedule's timers are fake; file system work runs for real.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Waits for real file system work until the schedule reaches a state.
  async function until(condition: () => boolean) {
    for (let turn = 0; turn < 1000 && !condition(); turn++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(condition()).toBe(true);
  }

  // Waits until `count` checks have finished and the next one is scheduled.
  function checked(github: { calls: GraphQLCall[] }, count: number) {
    return until(() => github.calls.length === count && vi.getTimerCount() === 1);
  }

  it("checks at once, then every 60 seconds by default", async () => {
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull)]);

    const stop = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(github.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await checked(github, 2);

    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks at the interval set in the config", async () => {
    await writeConfig({ checkIntervalSeconds: 120 });
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull)]);

    const stop = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(github.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await checked(github, 2);

    stop();
  });

  it("keeps checking after a check fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const github = fakeGitHub([]);

    const stop = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await checked(github, 2);

    expect(logged).toHaveBeenCalledWith("stunt: check failed:", expect.any(Error));
    stop();
  });

  it.each([[0], [1.5], ["60"]])(
    "refuses to start with a check interval of %j, naming the config file",
    async (checkIntervalSeconds) => {
      await writeConfig({ checkIntervalSeconds });

      await expect(stunt(fakeGitHub([])).start()).rejects.toThrow(
        `config file ${configPath()}: checkIntervalSeconds must be a whole number of seconds above 0`,
      );
    },
  );

  it("refuses to start with a config file that is not valid JSON", async () => {
    await mkdir(path.dirname(configPath()), { recursive: true });
    await writeFile(configPath(), "{ not json");

    await expect(stunt(fakeGitHub([])).start()).rejects.toThrow(
      `config file ${configPath()} is not valid JSON`,
    );
  });
});
