import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
// Recorded and stripped the same way, by the query for the Issue tracker
// declaration on the default branch of a repository that has one, of one that
// has none, and of one GitHub does not find.
import declarationsFull from "./fixtures/declarations.json" with { type: "json" };
// Recorded and stripped the same way, by the query for the Tickets PR bodies
// name: one with a parent, one without, and one GitHub does not find.
import ticketsFull from "./fixtures/tickets.json" with { type: "json" };
// Recorded and stripped the same way, by the query for the `.scratch` tree on
// the default branch of a Local Markdown repository whose Tickets link PRs
// #25 and #27, of one with no `.scratch`, and of one GitHub does not find.
import scratchFull from "./fixtures/scratch.json" with { type: "json" };

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

// A repository's answer to the query for its Issue tracker declaration.
type Declaration = (typeof declarationsFull)["data"]["repository0" | "repository1"] | "not found";

// The recorded answer of a repository with a declaration on its default
// branch, one with none, and one GitHub does not find.
const DECLARED = declarationsFull.data.repository0;
const UNDECLARED = declarationsFull.data.repository1;
const NOT_FOUND = "not found";

// An issue's answer to the query for the Tickets PR bodies name.
type Ticket = (typeof ticketsFull)["data"]["ticket0" | "ticket1"]["issue"] | "not found";

// The recorded Ticket #12 of owner-1/repo-2, whose parent is Feature #1, and
// Feature #1, which has no parent.
const PARENTED: Ticket = ticketsFull.data.ticket0.issue;
const PARENTLESS: Ticket = ticketsFull.data.ticket1.issue;

// A repository's answer to the query for its `.scratch` tree.
type ScratchTree = (typeof scratchFull)["data"]["repository0" | "repository1"] | "not found";

// The recorded answer of a repository whose `.scratch` tree on its default
// branch holds Features `cart-pending-changes`, with Tickets
// `01-reconcile.md` linking #25 and `02-registry.md` linking #27, and
// `oci-braintree`, whose one Ticket links none; and of one with no
// `.scratch`.
const SCRATCHED = scratchFull.data.repository0;
const UNSCRATCHED = scratchFull.data.repository1;

// The recorded check responses predate the query reading PR bodies, so each
// PR in `data` gets an empty body unless a test gives it one.
function withBodies(data: Record<string, unknown>) {
  const prs = Object.entries(data).flatMap(([key, value]) => {
    if (key === "assigned" || key === "inbox") return (value as { nodes: object[] } | undefined)?.nodes ?? [];
    return [];
  });
  for (const pr of prs) if (!("body" in pr)) Object.assign(pr, { body: "" });
}

// Replays recorded response bodies in order, one per check query. A query
// for Issue tracker declarations on default branches is answered from
// `declarations`, by repository, a repository left out having none; those
// queries are kept apart in `declarationCalls`. A query for the Tickets PR
// bodies name is answered from `tickets`, by `owner/repo#N`; those queries are
// kept apart in `ticketCalls`. A query for `.scratch` trees on default
// branches is answered from `scratchTrees`, by repository, a repository left
// out having none; those queries are kept apart in `scratchCalls`.
function fakeGitHub(
  responses: Response[],
  declarations: Record<string, Declaration> = {},
  tickets: Record<string, Ticket> = {},
  scratchTrees: Record<string, ScratchTree> = {},
): GitHubClient & {
  calls: GraphQLCall[];
  declarationCalls: GraphQLCall[];
  ticketCalls: GraphQLCall[];
  scratchCalls: GraphQLCall[];
} {
  const queue = [...responses];
  const calls: GraphQLCall[] = [];
  const declarationCalls: GraphQLCall[] = [];
  const ticketCalls: GraphQLCall[] = [];
  const scratchCalls: GraphQLCall[] = [];
  return {
    calls,
    declarationCalls,
    ticketCalls,
    scratchCalls,
    async graphql(query, variables) {
      if (query.startsWith("query Scratch")) {
        scratchCalls.push({ query, variables });
        const data: Record<string, unknown> = {};
        const errors: unknown[] = [];
        for (let i = 0; `owner${i}` in variables; i++) {
          const tree = scratchTrees[`${variables[`owner${i}`]}/${variables[`name${i}`]}`] ?? UNSCRATCHED;
          data[`repository${i}`] = tree === NOT_FOUND ? null : tree;
          if (tree === NOT_FOUND) errors.push({ ...scratchFull.errors[0], path: [`repository${i}`] });
        }
        return structuredClone(errors.length === 0 ? { data } : { data, errors });
      }
      if (query.startsWith("query Tickets")) {
        ticketCalls.push({ query, variables });
        const data: Record<string, unknown> = {};
        const errors: unknown[] = [];
        for (let i = 0; `owner${i}` in variables; i++) {
          const key = `${variables[`owner${i}`]}/${variables[`name${i}`]}#${variables[`number${i}`]}`;
          const ticket = tickets[key];
          if (ticket === undefined) throw new Error(`no recorded Ticket ${key}`);
          data[`ticket${i}`] = { issue: ticket === NOT_FOUND ? null : ticket };
          if (ticket === NOT_FOUND) errors.push({ ...ticketsFull.errors[0], path: [`ticket${i}`, "issue"] });
        }
        return structuredClone(errors.length === 0 ? { data } : { data, errors });
      }
      if (query.startsWith("query Declarations")) {
        declarationCalls.push({ query, variables });
        const data: Record<string, unknown> = {};
        const errors: unknown[] = [];
        for (let i = 0; `owner${i}` in variables; i++) {
          const declaration = declarations[`${variables[`owner${i}`]}/${variables[`name${i}`]}`] ?? UNDECLARED;
          data[`repository${i}`] = declaration === NOT_FOUND ? null : declaration;
          if (declaration === NOT_FOUND) errors.push({ ...declarationsFull.errors[0], path: [`repository${i}`] });
        }
        return structuredClone(errors.length === 0 ? { data } : { data, errors });
      }
      calls.push({ query, variables });
      if (queue.length === 0) throw new Error("no recorded response left");
      const response = queue.shift();
      const body = structuredClone(typeof response === "function" ? response(variables) : response);
      const data = (body as { data?: Record<string, unknown> | null }).data;
      if (data !== undefined && data !== null) withBodies(data);
      return body;
    },
  };
}

function configPath() {
  return path.join(dir, "config", "config.json");
}

// The home directory, whose `repos` is the default clone root.
function home() {
  return path.join(dir, "home");
}

function stunt(github: GitHubClient, now = NOW) {
  return openStunt({
    github,
    dataDir: path.join(dir, "data"),
    configPath: configPath(),
    home: home(),
    clock: { now: () => now },
  });
}

// Makes a local clone at `at` whose `origin` is `url`, holding `declaration`
// as its Issue tracker declaration when given.
async function clone(at: string, url: string, declaration?: string) {
  await mkdir(path.join(at, ".git"), { recursive: true });
  await writeFile(
    path.join(at, ".git", "config"),
    `[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main\n`,
  );
  if (declaration === undefined) return;
  await mkdir(path.join(at, "docs", "agents"), { recursive: true });
  await writeFile(path.join(at, "docs", "agents", "issue-tracker.md"), declaration);
}

// Writes `text` at `file` under the `.scratch` tree of the clone at `at`,
// such as a Ticket at `<feature-slug>/issues/NN-<slug>.md`.
async function scratch(at: string, file: string, text: string) {
  await mkdir(path.dirname(path.join(at, ".scratch", file)), { recursive: true });
  await writeFile(path.join(at, ".scratch", file), text);
}

// Each repository's Issue tracker in `model`, by name.
function issueTrackers(model: Awaited<ReturnType<typeof modelOf>>) {
  return Object.fromEntries(model.repositories.map((repository) => [repository.name, repository.issueTracker]));
}

async function writeConfig(config: unknown) {
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config));
}

type Recorded = { data: object };

// The recorded Review inbox, emptied, for checks about Assigned PRs alone.
const NO_INBOX = { data: { ...inboxFull.data, inbox: { ...inboxFull.data.inbox, nodes: [] } } };

// The recorded Assigned PRs, emptied, for checks about Review requests alone.
const NO_ASSIGNED = { data: { ...assignedFull.data, assigned: { ...assignedFull.data.assigned, nodes: [] } } };

type RecordedInboxPR = (typeof inboxFull)["data"]["inbox"]["nodes"][number];

// One check's response: recorded Assigned PRs and a recorded Review inbox,
// which were recorded apart.
function checkResponse(assigned: Recorded, inbox: Recorded = NO_INBOX) {
  return { data: { ...assigned.data, ...inbox.data } };
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

// The recorded Review inbox, holding only PRs `numbers`.
function inboxHolding(...numbers: number[]) {
  const response = structuredClone(inboxFull);
  response.data.inbox.nodes = response.data.inbox.nodes.filter((node) => numbers.includes(node.number));
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
    .flatMap((repository) => repository.assignedPRs.flatMap((group) => group.prs))
    .find((pr) => pr.number === number);
  if (row === undefined) throw new Error(`no Assigned PR row for #${number}`);
  return row;
}

// The Review inbox of `repository` after one check returning the Review inbox
// in `inbox`.
async function inboxOf(inbox: Recorded, repository: string) {
  return inboxRows(await modelOf(checkResponse(assignedFull, inbox)), repository);
}

// The Review inbox rows of `repository` in `model`, in order across their
// Feature groups.
function inboxRows(model: Awaited<ReturnType<typeof modelOf>>, repository: string) {
  return (
    model.repositories
      .find((candidate) => candidate.name === repository)
      ?.reviewInbox.flatMap((group) => group.prs) ?? []
  );
}

// The page model after one check returning `response`, in a data directory of
// its own.
async function modelOf(response: unknown) {
  const reference = openStunt({
    github: fakeGitHub([response]),
    dataDir: await mkdtemp(path.join(dir, "reference-")),
    configPath: configPath(),
    home: home(),
    clock: { now: () => NOW },
  });
  await reference.check();
  return reference.pageModel();
}

// Assigned PR rows grouped as a repository with no Feature shows them: all
// under Unfiled.
function unfiled<Row>(...prs: Row[]) {
  return [{ feature: null, prs }];
}

// The page model after one check of assigned-prs-full.json at NOW.
const ALL_ASSIGNED = {
  checkedAt: "2026-11-01T12:00:00.000Z",
  repositories: [
    {
      name: "owner-1/repo-1",
      // No clone and no declaration on GitHub: every Assigned PR is Unfiled.
      issueTracker: null,
      counts: { assignedPRs: 1, reviewInbox: 0 },
      reviewInbox: [],
      assignedPRs: unfiled(
        {
          number: 136,
          title: "Assigned PR 1",
          url: "https://github.com/owner-1/repo-1/pull/136",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "changes requested",
          updatedAgo: "15 days ago",
          updatedAt: "2026-10-16T14:23:50Z",
          reviewers: [{ reviewer: "user-2", state: "changes requested" }],
          reviews: [{ reviewer: "user-2", state: "changes requested", submittedAgo: "2 months ago" }],
          pendingReviewers:[],
        },
      ),
    },
    {
      name: "owner-1/repo-2",
      issueTracker: null,
      counts: { assignedPRs: 3, reviewInbox: 0 },
      reviewInbox: [],
      assignedPRs: unfiled(
        {
          number: 10420,
          title: "Assigned PR 3",
          url: "https://github.com/owner-1/repo-2/pull/10420",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "review required",
          updatedAgo: "1 day ago",
          updatedAt: "2026-10-30T17:15:20Z",
          reviewers: [{ reviewer: "user-2", state: "commented" }],
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "1 day ago" }],
          pendingReviewers:[],
        },
        {
          number: 10412,
          title: "Assigned PR 2",
          url: "https://github.com/owner-1/repo-2/pull/10412",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "review required",
          updatedAgo: "2 days ago",
          updatedAt: "2026-10-29T15:32:37Z",
          reviewers: [{ reviewer: "user-2", state: "pending" }],
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "2 days ago" }],
          pendingReviewers:["user-2"],
        },
        {
          number: 9968,
          title: "Assigned PR 4",
          url: "https://github.com/owner-1/repo-2/pull/9968",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "changes requested",
          updatedAgo: "15 days ago",
          updatedAt: "2026-10-16T14:23:42Z",
          reviewers: [
            { reviewer: "user-2", state: "changes requested" },
            { reviewer: "user-3", state: "approved" },
          ],
          reviews: [
            { reviewer: "user-2", state: "changes requested", submittedAgo: "1 month ago" },
            { reviewer: "user-3", state: "approved", submittedAgo: "1 month ago" },
          ],
          pendingReviewers:[],
        },
      ),
    },
    {
      name: "owner-1/repo-3",
      issueTracker: null,
      counts: { assignedPRs: 1, reviewInbox: 0 },
      reviewInbox: [],
      assignedPRs: unfiled(
        // Assigned PRs include drafts.
        {
          number: 381,
          title: "Assigned PR 5",
          url: "https://github.com/owner-1/repo-3/pull/381",
          author: "user-1",
          draft: true,
          pendingReview: false,
          reviewStatus: "review required",
          updatedAgo: "5 days ago",
          updatedAt: "2026-10-26T15:56:29Z",
          reviewers: [],
          reviews: [],
          pendingReviewers:[],
        },
      ),
    },
    {
      name: "owner-2/repo-4",
      issueTracker: null,
      counts: { assignedPRs: 3, reviewInbox: 0 },
      reviewInbox: [],
      // Reviewed after NOW, by when they were recorded, so those times read
      // as just now.
      assignedPRs: unfiled(
        {
          number: 28,
          title: "Assigned PR 8",
          url: "https://github.com/owner-2/repo-4/pull/28",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "review required",
          updatedAgo: "just now",
          updatedAt: "2026-11-02T09:39:38Z",
          reviewers: [{ reviewer: "user-2", state: "commented" }],
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "just now" }],
          pendingReviewers:[],
        },
        {
          number: 27,
          title: "Assigned PR 7",
          url: "https://github.com/owner-2/repo-4/pull/27",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "review required",
          updatedAgo: "just now",
          updatedAt: "2026-11-02T09:16:05Z",
          reviewers: [{ reviewer: "user-2", state: "commented" }],
          reviews: [{ reviewer: "user-2", state: "commented", submittedAgo: "just now" }],
          pendingReviewers:[],
        },
        {
          number: 25,
          title: "Assigned PR 6",
          url: "https://github.com/owner-2/repo-4/pull/25",
          author: "user-1",
          draft: false,
          pendingReview: false,
          reviewStatus: "approved",
          updatedAgo: "just now",
          updatedAt: "2026-11-02T09:14:42Z",
          reviewers: [{ reviewer: "user-2", state: "approved" }],
          reviews: [{ reviewer: "user-2", state: "approved", submittedAgo: "21 hours ago" }],
          pendingReviewers:[],
        },
      ),
    },
  ],
  owners: [
    {
      owner: "owner-1",
      repositories: [
        { name: "owner-1/repo-1", counts: { assignedPRs: 1, reviewInbox: 0 } },
        { name: "owner-1/repo-2", counts: { assignedPRs: 3, reviewInbox: 0 } },
        { name: "owner-1/repo-3", counts: { assignedPRs: 1, reviewInbox: 0 } },
      ],
    },
    {
      owner: "owner-2",
      repositories: [{ name: "owner-2/repo-4", counts: { assignedPRs: 3, reviewInbox: 0 } }],
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
    expect(repositories[0].assignedPRs.flatMap((group) => group.prs).map((pr) => pr.number)).toEqual([10420, 9968]);
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
    expect(await stunt(fakeGitHub([])).pageModel()).toEqual({ repositories: [], owners: [] });
  });

  it("loads a state saved while Tasks existed, and keeps working", async () => {
    await mkdir(path.join(dir, "data"), { recursive: true });
    await writeFile(
      path.join(dir, "data", "state.json"),
      JSON.stringify({ baseline: "2026-10-01T12:00:00.000Z", tasks: [{ id: "review-1", state: "open" }], assignedPRs: [], reviewInbox: [] }),
    );
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("fails on a GitHub error", async () => {
    const failing = { data: null, errors: [{ type: "NOT_FOUND", path: ["viewer"], message: "Not found" }] };

    await expect(stunt(fakeGitHub([failing])).check()).rejects.toThrow("GitHub GraphQL query failed: Not found");
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
    expect((await rowOf(assignedFull, 381)).reviews).toEqual([]);
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
    expect((await rowOf(assignedFull, 10412)).pendingReviewers).toEqual(["user-2"]);
    expect((await rowOf(assignedFull, 9968)).pendingReviewers).toEqual([]);
  });

  it("shows each reviewer's standing verdict or comment, most recent first", async () => {
    expect((await rowOf(assignedFull, 9968)).reviewers).toEqual([
      { reviewer: "user-2", state: "changes requested" },
      { reviewer: "user-3", state: "approved" },
    ]);
    expect((await rowOf(assignedFull, 10420)).reviewers).toEqual([{ reviewer: "user-2", state: "commented" }]);
    expect((await rowOf(assignedFull, 381)).reviewers).toEqual([]);
  });

  it("shows a reviewer requested again as pending, not their earlier review", async () => {
    expect((await rowOf(assignedFull, 10412)).reviewers).toEqual([{ reviewer: "user-2", state: "pending" }]);
  });

  it("shows everyone still requested as pending after those who reviewed, teams by their slug", async () => {
    const response = withPR(9968, (pr) => {
      pr.reviewRequests.nodes = [
        { requestedReviewer: { __typename: "User", login: "user-4" } },
        { requestedReviewer: { __typename: "Team", combinedSlug: "owner-1/team-1" } },
      ] as RecordedPR["reviewRequests"]["nodes"];
    });

    expect((await rowOf(response, 9968)).reviewers).toEqual([
      { reviewer: "user-2", state: "changes requested" },
      { reviewer: "user-3", state: "approved" },
      { reviewer: "user-4", state: "pending" },
      { reviewer: "owner-1/team-1", state: "pending" },
    ]);
  });

  it("shows no one for a dismissed verdict, unless they are still requested", async () => {
    const response = withPR(10412, (pr) => {
      pr.reviews.nodes = [
        review("user-2", "DISMISSED", "2026-11-01T09:00:00Z"),
        review("user-3", "DISMISSED", "2026-11-01T09:30:00Z"),
      ] as RecordedPR["reviews"]["nodes"];
    });

    expect((await rowOf(response, 10412)).reviewers).toEqual([{ reviewer: "user-2", state: "pending" }]);
  });

  it("holds a team a review is still requested from by its slug", async () => {
    const response = withPR(10412, (pr) => {
      (pr.reviewRequests.nodes as unknown[]).push({
        requestedReviewer: { __typename: "Team", combinedSlug: "owner-1/team-1" },
      });
    });

    expect((await rowOf(response, 10412)).pendingReviewers).toEqual(["user-2", "owner-1/team-1"]);
  });
});

// I am user-1, and authored every recorded Assigned PR.
describe("Pending review", () => {
  // #10420 as authored by user-3, with `reviews`, and a Review request
  // pending for each of `requested`.
  function authoredByOthers(reviews: unknown[], ...requested: unknown[]) {
    return withPR(10420, (pr) => {
      pr.author = { login: "user-3" };
      pr.reviews.nodes = reviews as RecordedPR["reviews"]["nodes"];
      pr.reviewRequests.nodes = requested.map((requestedReviewer) => ({ requestedReviewer })) as RecordedPR["reviewRequests"]["nodes"];
    });
  }

  const ME = { __typename: "User", login: "user-1" };

  it("holds an Assigned PR someone else authored that I never reviewed", async () => {
    const response = authoredByOthers([review("user-2", "APPROVED", "2026-11-01T09:00:00Z")]);

    expect((await rowOf(response, 10420)).pendingReview).toBe(true);
  });

  it("holds an Assigned PR someone else authored with a Review request pending for me, though I reviewed it before", async () => {
    const response = authoredByOthers([review("user-1", "APPROVED", "2026-11-01T09:00:00Z")], ME);

    expect((await rowOf(response, 10420)).pendingReview).toBe(true);
  });

  it("holds an Assigned PR someone else authored while my only review is a pending draft", async () => {
    const response = authoredByOthers([{ state: "PENDING", submittedAt: null, author: { login: "user-1" } }]);

    expect((await rowOf(response, 10420)).pendingReview).toBe(true);
  });

  it.each([
    ["with no Review request pending for me", []],
    ["with a Review request pending only for a team of mine", [{ __typename: "Team", combinedSlug: "owner-1/team-1" }]],
  ])("leaves out an Assigned PR someone else authored that I reviewed, %s", async (_, requested) => {
    const response = authoredByOthers([review("user-1", "COMMENTED", "2026-11-01T09:00:00Z")], ...requested);

    expect((await rowOf(response, 10420)).pendingReview).toBe(false);
  });

  it("never holds an Assigned PR I authored", async () => {
    const response = withPR(10420, (pr) => {
      pr.reviewRequests.nodes = [{ requestedReviewer: ME }] as RecordedPR["reviewRequests"]["nodes"];
    });

    expect((await rowOf(response, 10420)).pendingReview).toBe(false);
  });
});

describe("an Assigned PR's Review status", () => {
  it.each([
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
        request: { by: "user-2", ago: "5 days ago", waitingSince: "2026-10-26T14:13:57Z" },
        reRequest: false,
      },
      {
        number: 10306,
        title: "Review inbox PR 11",
        url: "https://github.com/owner-1/repo-2/pull/10306",
        author: "user-2",
        request: { by: "user-2", ago: "5 days ago", waitingSince: "2026-10-26T14:14:07Z" },
        reRequest: false,
      },
      // Requested three times; I reviewed between the first and the second.
      {
        number: 10404,
        title: "Review inbox PR 5",
        url: "https://github.com/owner-1/repo-2/pull/10404",
        author: "user-3",
        request: { by: "user-3", ago: "2 days ago", waitingSince: "2026-10-30T11:56:08Z" },
        reRequest: true,
      },
      {
        number: 10419,
        title: "Review inbox PR 1",
        url: "https://github.com/owner-1/repo-2/pull/10419",
        author: "user-5",
        request: { by: "user-5", ago: "1 day ago", waitingSince: "2026-10-30T16:36:43Z" },
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
        checkResponse(NO_ASSIGNED, inboxFull),
        checkResponse(NO_ASSIGNED, reviewed),
        checkResponse(NO_ASSIGNED, reRequested),
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
      request: { by: "user-5", ago: "2 hours ago", waitingSince: "2026-11-01T10:00:00Z" },
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

    expect(model.repositories.find((repository) => repository.name === "owner-1/repo-5")).toMatchObject({
      assignedPRs: [],
    });
    expect(model.owners.find((row) => row.owner === "owner-1")?.repositories).toContainEqual({
      name: "owner-1/repo-5",
      counts: { assignedPRs: 0, reviewInbox: 12 },
    });
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
    expect(rows[3].request).toEqual({ by: "user-2", ago: "4 hours ago", waitingSince: "2026-11-01T08:00:00Z" });
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

describe("the dashboard and the sidebar", () => {
  it("group the repositories by owner, owners by name, each owner's repositories by name, with their counts", async () => {
    const model = await modelOf(checkResponse(assignedFull, inboxFull));

    expect(model.owners).toEqual([
      {
        owner: "owner-1",
        repositories: [
          { name: "owner-1/repo-1", counts: { assignedPRs: 1, reviewInbox: 0 } },
          { name: "owner-1/repo-2", counts: { assignedPRs: 3, reviewInbox: 4 } },
          { name: "owner-1/repo-3", counts: { assignedPRs: 1, reviewInbox: 1 } },
          { name: "owner-1/repo-5", counts: { assignedPRs: 0, reviewInbox: 12 } },
        ],
      },
      {
        owner: "owner-2",
        repositories: [{ name: "owner-2/repo-4", counts: { assignedPRs: 3, reviewInbox: 0 } }],
      },
    ]);
  });
});

// Two checks some days apart. Of the recorded Assigned PRs' reviews, only
// #10420's, #25's, #27's, and #28's come between them.
const EARLIER = new Date("2026-10-30T12:00:00Z");
const LATER = new Date("2026-11-02T12:00:00Z");

describe("Notifications", () => {
  it("announces the whole Review inbox at the first check, one Notification per repository, by name", async () => {
    const notifications = await stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)])).check();

    expect(notifications.map((notification) => notification.title)).toEqual([
      "owner-1/repo-2: 4 new Review requests",
      "owner-1/repo-3: 1 new Review request",
      "owner-1/repo-5: 12 new Review requests",
    ]);
  });

  it("announces a Review request a failed check saw only once, at the next check that succeeds", async () => {
    const inbox = inboxHolding(368);
    const failing = { data: null, errors: [{ type: "NOT_FOUND", path: ["viewer"], message: "Not found" }] };
    const app = stunt(fakeGitHub([failing, checkResponse(NO_ASSIGNED, inbox), checkResponse(NO_ASSIGNED, inbox)]));

    await expect(app.check()).rejects.toThrow("GitHub GraphQL query failed: Not found");

    expect((await app.check()).map((notification) => notification.title)).toEqual([
      "owner-1/repo-3: 1 new Review request",
    ]);
    expect(await app.check()).toEqual([]);
  });

  it("announces a check's new Review requests, one per repository, listing each PR and who requested it, oldest first", async () => {
    const notifications = await stunt(fakeGitHub([checkResponse(assignedFull, inboxHolding(10419, 10404, 368))])).check();

    expect(notifications).toEqual([
      {
        repository: "owner-1/repo-2",
        title: "owner-1/repo-2: 2 new Review requests",
        body: "#10404 by user-3\n#10419 by user-5",
      },
      {
        repository: "owner-1/repo-3",
        title: "owner-1/repo-3: 1 new Review request",
        body: "#368 by user-2",
      },
    ]);
  });

  // Notifications reach only the tabs open when they are made, so a Review
  // request seen while no tab was open is never announced.
  it("announces each Review request only at the check that first sees it, across checks and restarts", async () => {
    const inbox = inboxHolding(368);
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inbox), checkResponse(assignedFull, inbox)]));

    const first = await app.check();
    const later = await app.check();
    const restarted = await stunt(fakeGitHub([checkResponse(assignedFull, inbox)]), LATER).check();

    expect(first.map((notification) => notification.title)).toEqual(["owner-1/repo-3: 1 new Review request"]);
    expect(later).toEqual([]);
    expect(restarted).toEqual([]);
  });

  it("announces a re-request as a new Review request", async () => {
    const reRequested = inboxHolding(368);
    const [pr] = reRequested.data.inbox.nodes;
    (pr.reviews.nodes as unknown[]).push(review("user-1", "COMMENTED", "2026-11-01T11:00:00Z"));
    pr.timelineItems.nodes.push(requested("user-2", "user-1", "2026-11-01T11:30:00Z"));
    const app = stunt(fakeGitHub([checkResponse(NO_ASSIGNED, inboxHolding(368)), checkResponse(NO_ASSIGNED, reRequested)]));

    await app.check();

    expect(await app.check()).toEqual([
      {
        repository: "owner-1/repo-3",
        title: "owner-1/repo-3: 1 new Review request",
        body: "#368 by user-2",
      },
    ]);
  });

  it("announces no review on an Assigned PR", async () => {
    await stunt(fakeGitHub([checkResponse(assignedFull)]), EARLIER).check();

    expect(await stunt(fakeGitHub([checkResponse(assignedFull)]), LATER).check()).toEqual([]);
  });

  it("names no one for a request too old for the check to have read", async () => {
    const inbox = inboxHolding(10419);
    const pr = inbox.data.inbox.nodes[0];
    pr.timelineItems.nodes = pr.timelineItems.nodes.filter((event) => event.requestedReviewer.login !== "user-1");

    const notifications = await stunt(fakeGitHub([checkResponse(assignedFull, inbox)])).check();

    expect(notifications).toEqual([
      {
        repository: "owner-1/repo-2",
        title: "owner-1/repo-2: 1 new Review request",
        body: "#10419",
      },
    ]);
  });
});

describe("the Issue tracker", () => {
  // The Issue tracker declarations of the clones below.
  const GITHUB = DECLARED.object.text;
  const LOCAL_MARKDOWN = "---\nstatus: instructional\n---\n\n# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n";
  const GITLAB = "# Issue tracker: GitLab\n\nIssues and merge requests for this repo live in GitLab, via the `glab` CLI.\n";

  // ALL_ASSIGNED with each repository's Issue tracker from `trackers`.
  function allAssignedWith(trackers: Record<string, string | null>) {
    return {
      ...ALL_ASSIGNED,
      repositories: ALL_ASSIGNED.repositories.map((repository) => ({
        ...repository,
        issueTracker: trackers[repository.name],
      })),
    };
  }

  it("is read from the title of the declaration in each repository's clone under ~/repos, matched by its origin, every Assigned PR still Unfiled", async () => {
    const root = path.join(home(), "repos");
    await clone(path.join(root, "owner-1", "repo-1"), "git@github.com:owner-1/repo-1.git", GITHUB);
    await clone(path.join(root, "two"), "https://github.com/owner-1/repo-2.git", LOCAL_MARKDOWN);
    await clone(path.join(root, "work", "team", "three"), "ssh://git@github.com/Owner-1/Repo-3", GITLAB);
    // A missing declaration in a clone is not looked for on GitHub.
    await clone(path.join(root, "owner-2", "repo-4"), "git@github.com:owner-2/repo-4.git");
    const github = fakeGitHub([checkResponse(assignedFull)], { "owner-2/repo-4": DECLARED });
    const app = stunt(github);

    await app.check();

    expect(await app.pageModel()).toEqual(
      allAssignedWith({
        "owner-1/repo-1": "GitHub",
        "owner-1/repo-2": "Local Markdown",
        "owner-1/repo-3": null,
        "owner-2/repo-4": null,
      }),
    );
    expect(github.declarationCalls).toEqual([]);
  });

  it("is read from clones under the clone root set in the config, which may start at ~", async () => {
    await writeConfig({ cloneRoot: "~/code" });
    await clone(path.join(home(), "code", "repo-1"), "git@github.com:owner-1/repo-1.git", GITHUB);
    // Not under the configured root, so not found.
    await clone(path.join(home(), "repos", "repo-2"), "git@github.com:owner-1/repo-2.git", LOCAL_MARKDOWN);
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(issueTrackers(await app.pageModel())).toEqual({
      "owner-1/repo-1": "GitHub",
      "owner-1/repo-2": null,
      "owner-1/repo-3": null,
      "owner-2/repo-4": null,
    });
  });

  it("is read from the clone the config names for a repository, outside the clone root or over a clone the scan finds", async () => {
    const outside = path.join(dir, "elsewhere");
    await writeConfig({
      clones: {
        "owner-1/repo-1": path.join(outside, "one"),
        "Owner-2/Repo-4": path.join(outside, "four"),
      },
    });
    await clone(path.join(outside, "one"), "git@github.com:owner-1/repo-1.git", LOCAL_MARKDOWN);
    await clone(path.join(home(), "repos", "repo-1"), "git@github.com:owner-1/repo-1.git", GITHUB);
    await clone(path.join(outside, "four"), "git@github.com:owner-2/repo-4.git", GITHUB);
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(issueTrackers(await app.pageModel())).toEqual({
      "owner-1/repo-1": "Local Markdown",
      "owner-1/repo-2": null,
      "owner-1/repo-3": null,
      "owner-2/repo-4": "GitHub",
    });
  });

  it("is read from the scan, or else GitHub, when the clone the config names is not a clone, warning about it", async () => {
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    const missing = path.join(dir, "elsewhere", "one");
    await writeConfig({ clones: { "owner-1/repo-1": missing, "owner-1/repo-2": path.join(dir, "elsewhere", "two") } });
    await clone(path.join(home(), "repos", "repo-1"), "git@github.com:owner-1/repo-1.git", LOCAL_MARKDOWN);
    const github = fakeGitHub([checkResponse(assignedFull)], { "owner-1/repo-2": DECLARED });
    const app = stunt(github);

    await app.check();

    expect(issueTrackers(await app.pageModel())).toMatchObject({
      "owner-1/repo-1": "Local Markdown",
      "owner-1/repo-2": "GitHub",
    });
    expect(warned).toHaveBeenCalledWith(`stunt: the clone of owner-1/repo-1 in the config, ${missing}, is not a git clone`);
    warned.mockRestore();
  });

  it("is read from the GitHub default branch of each repository without a clone, in one query", async () => {
    await clone(path.join(home(), "repos", "repo-1"), "git@github.com:owner-1/repo-1.git", GITHUB);
    const github = fakeGitHub([checkResponse(assignedFull, inboxFull)], {
      "owner-1/repo-1": UNDECLARED,
      // owner-1/repo-2 has no declaration on GitHub either.
      "owner-1/repo-3": NOT_FOUND,
      "owner-2/repo-4": {
        object: { text: DECLARED.object.text.replace("# Issue tracker: GitHub", "# Issue tracker: GitLab") },
      },
      "owner-1/repo-5": DECLARED,
    });
    const app = stunt(github);

    await app.check();

    expect(issueTrackers(await app.pageModel())).toEqual({
      "owner-1/repo-1": "GitHub",
      "owner-1/repo-2": null,
      "owner-1/repo-3": null,
      "owner-2/repo-4": null,
      "owner-1/repo-5": "GitHub",
    });
    expect(github.declarationCalls).toHaveLength(1);
    const { variables } = github.declarationCalls[0];
    const asked = Object.keys(variables)
      .filter((key) => key.startsWith("owner"))
      .map((key) => `${variables[key]}/${variables[key.replace("owner", "name")]}`);
    expect(asked.toSorted()).toEqual(["owner-1/repo-2", "owner-1/repo-3", "owner-1/repo-5", "owner-2/repo-4"]);
  });

  it("fails a check on any other GitHub error reading a declaration", async () => {
    const github = fakeGitHub([checkResponse(assignedFull)]);
    github.graphql = async (query, variables) => {
      if (query.startsWith("query Declarations")) return { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] };
      return fakeGitHub([checkResponse(assignedFull)]).graphql(query, variables);
    };

    await expect(stunt(github).check()).rejects.toThrow("API rate limit exceeded");
  });

  it.each([
    [{ cloneRoot: "repos" }, "cloneRoot must be an absolute path or start at ~/"],
    [{ cloneRoot: 7 }, "cloneRoot must be an absolute path or start at ~/"],
    [{ clones: ["/repos/repo-1"] }, 'clones must map each "owner/repo" to an absolute path or one starting at ~/'],
    [{ clones: { "repo-1": "/repos/repo-1" } }, 'clones must map each "owner/repo" to an absolute path or one starting at ~/'],
    [{ clones: { "owner-1/repo-1": "repo-1" } }, 'clones must map each "owner/repo" to an absolute path or one starting at ~/'],
  ])("fails a check when the config holds %j, naming the config file", async (config, message) => {
    await writeConfig(config);

    await expect(stunt(fakeGitHub([checkResponse(assignedFull)])).check()).rejects.toThrow(
      `config file ${configPath()}: ${message}`,
    );
  });
});

// The rows of `numbers` in `repository` after a check of
// assigned-prs-full.json at NOW, in that order.
function rows(repository: string, ...numbers: number[]) {
  const prs = ALL_ASSIGNED.repositories
    .find((candidate) => candidate.name === repository)
    ?.assignedPRs.flatMap((group) => group.prs);
  return numbers.map((number) => {
    const row = prs?.find((pr) => pr.number === number);
    if (row === undefined) throw new Error(`no Assigned PR row for ${repository}#${number}`);
    return row;
  });
}

// The Assigned PR groups of `repository` in `model`.
function groupsOf(model: Awaited<ReturnType<typeof modelOf>>, repository: string) {
  return model.repositories.find((candidate) => candidate.name === repository)?.assignedPRs;
}

describe("Feature grouping in a Local Markdown repository", () => {
  const LOCAL_MARKDOWN = "# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n";

  // Makes a Local Markdown clone of `repository` under ~/repos, and gives its
  // path.
  async function localMarkdownClone(repository: string) {
    const at = path.join(home(), "repos", repository);
    await clone(at, `git@github.com:${repository}.git`, LOCAL_MARKDOWN);
    return at;
  }

  // A Ticket naming its PR in its header, the way the implement skills write
  // it.
  function ticket(title: string, pr: number) {
    return `# ${title}\n\nStatus: ready-for-agent\n\n**PR:** #${pr} (merged 2026-10-26, squash \`f921607e9\`)\n\n## What to build\n\nThe change.\n`;
  }

  it("groups an Assigned PR under the Feature, named after it, whose Ticket's PR line names it, with Unfiled first", async () => {
    const at = await localMarkdownClone("owner-2/repo-4");
    await scratch(at, "cart-pending-changes/spec.md", "# Cart pending changes\n");
    await scratch(at, "cart-pending-changes/issues/01-reconcile-payment-step-registries.md", ticket("01. Reconcile", 25));
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-2/repo-4")).toEqual([
      { feature: null, prs: rows("owner-2/repo-4", 28, 27) },
      { feature: "Cart pending changes", prs: rows("owner-2/repo-4", 25) },
    ]);
  });

  it("links a PR by a PR line anywhere in a Ticket, and by no other mention in a Ticket or spec", async () => {
    const at = await localMarkdownClone("owner-2/repo-4");
    await scratch(
      at,
      "cart-pending-changes/spec.md",
      "# Cart pending changes\n\n**PR:** #28\n\n- History: the flag was introduced in PR #28.\n",
    );
    await scratch(at, "cart-pending-changes/map.md", "# Cart pending changes\n\n**PR:** #28\n");
    await scratch(
      at,
      "cart-pending-changes/issues/01-reconcile-payment-step-registries.md",
      "# 01. Reconcile\n\nStacked on #27\n\nThe change, see **PR:** #28.\n\n## Comments\n\n2026-10-26: shipped in PR #27.\n\n**PR:** #25\n",
    );
    await scratch(at, "cart-pending-changes/issues/notes.md", "**PR:** #27\n");
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-2/repo-4")).toEqual([
      { feature: null, prs: rows("owner-2/repo-4", 28, 27) },
      { feature: "Cart pending changes", prs: rows("owner-2/repo-4", 25) },
    ]);
  });

  it("orders Features by name, and each Feature's PRs by Ticket number", async () => {
    const at = await localMarkdownClone("owner-1/repo-2");
    // #10412 was updated after #9968, but its Ticket comes later.
    await scratch(at, "cart-pending-changes/issues/99-reconcile.md", ticket("99. Reconcile", 9968));
    await scratch(at, "cart-pending-changes/issues/100-registry.md", ticket("100. Registry", 10412));
    // #10420 was updated last of all.
    await scratch(at, "oci-braintree/issues/01-skip-stripe-steps.md", ticket("01. Skip Stripe steps", 10420));
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: "Cart pending changes", prs: rows("owner-1/repo-2", 9968, 10412) },
      { feature: "Oci braintree", prs: rows("owner-1/repo-2", 10420) },
    ]);
  });

  it("keeps a PR two Tickets link under the first Feature by name", async () => {
    const at = await localMarkdownClone("owner-1/repo-2");
    await scratch(at, "oci-braintree/issues/01-skip-stripe-steps.md", ticket("01. Skip Stripe steps", 10420));
    await scratch(at, "cart-pending-changes/issues/02-registry.md", ticket("02. Registry", 10420));
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10412, 9968) },
      { feature: "Cart pending changes", prs: rows("owner-1/repo-2", 10420) },
    ]);
  });

  it("orders a PR two Tickets of one Feature link by the lower Ticket number", async () => {
    const at = await localMarkdownClone("owner-1/repo-2");
    // #10412 was updated after #9968.
    await scratch(at, "cart-pending-changes/issues/01-reconcile.md", ticket("01. Reconcile", 9968));
    await scratch(at, "cart-pending-changes/issues/02-registry.md", ticket("02. Registry", 10412));
    await scratch(at, "cart-pending-changes/issues/03-follow-up.md", ticket("03. Follow up", 9968));
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10420) },
      { feature: "Cart pending changes", prs: rows("owner-1/repo-2", 9968, 10412) },
    ]);
  });

  it("leaves the Review inbox not grouped by Feature, though a Ticket links its PR", async () => {
    const inbox = inboxRows(await modelOf(checkResponse(assignedFull, inboxFull)), "owner-1/repo-2");
    const at = await localMarkdownClone("owner-1/repo-2");
    await scratch(at, "cart-pending-changes/issues/01-reconcile.md", ticket("01. Reconcile", 10419));
    await scratch(at, "cart-pending-changes/issues/02-registry.md", ticket("02. Registry", 10420));
    const app = stunt(fakeGitHub([checkResponse(assignedFull, inboxFull)]));

    await app.check();

    const model = await app.pageModel();
    expect(inboxRows(model, "owner-1/repo-2")).toEqual(inbox);
    expect(inbox.map((pr) => pr.number)).toContain(10419);
    expect(groupsOf(model, "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10412, 9968) },
      { feature: "Cart pending changes", prs: rows("owner-1/repo-2", 10420) },
    ]);
  });

  it("leaves every Assigned PR Unfiled in a GitHub repository's clone, though a Ticket links its PR", async () => {
    const at = path.join(home(), "repos", "owner-2", "repo-4");
    await clone(at, "git@github.com:owner-2/repo-4.git", DECLARED.object.text);
    await scratch(at, "cart-pending-changes/issues/01-reconcile.md", ticket("01. Reconcile", 25));
    const app = stunt(fakeGitHub([checkResponse(assignedFull)]));

    await app.check();

    const model = await app.pageModel();
    expect(issueTrackers(model)).toMatchObject({ "owner-2/repo-4": "GitHub" });
    expect(groupsOf(model, "owner-2/repo-4")).toEqual([{ feature: null, prs: rows("owner-2/repo-4", 28, 27, 25) }]);
  });
});

describe("Feature grouping in a Local Markdown repository without a clone", () => {
  // owner-2/repo-4 has no clone and declares Local Markdown on its default
  // branch.
  const LOCAL_MARKDOWN_TRACKER = {
    "owner-2/repo-4": { object: { text: "# Issue tracker: Local Markdown\n\nIssues and specs live in `.scratch/`.\n" } },
  };

  it("groups an Assigned PR under the Feature whose Ticket on the default branch links it, named after it, in Ticket order, Unfiled first", async () => {
    const github = fakeGitHub([checkResponse(assignedFull)], LOCAL_MARKDOWN_TRACKER, {}, {
      "owner-2/repo-4": SCRATCHED,
    });
    const app = stunt(github);

    await app.check();

    // #28 is named only by `notes.md`, a file in `issues` that is not a
    // Ticket.
    expect(groupsOf(await app.pageModel(), "owner-2/repo-4")).toEqual([
      { feature: null, prs: rows("owner-2/repo-4", 28) },
      { feature: "Cart pending changes", prs: rows("owner-2/repo-4", 25, 27) },
    ]);
  });

  it("orders Features by name", async () => {
    const tree = structuredClone(SCRATCHED);
    // The recorded oci-braintree Ticket links no PR; here it links #28, which
    // was updated after #25 and #27.
    const ociTicket = tree.object.entries
      .find((entry) => entry.name === "oci-braintree")
      ?.object.entries?.find((entry) => entry.name === "issues")
      ?.object.entries?.find((entry) => entry.name === "01-skip-stripe-steps.md");
    if (ociTicket === undefined) throw new Error("no recorded oci-braintree Ticket");
    ociTicket.object.text += "\n**PR:** #28\n";
    const app = stunt(
      fakeGitHub([checkResponse(assignedFull)], LOCAL_MARKDOWN_TRACKER, {}, { "owner-2/repo-4": tree }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-2/repo-4")).toEqual([
      { feature: "Cart pending changes", prs: rows("owner-2/repo-4", 25, 27) },
      { feature: "Oci braintree", prs: rows("owner-2/repo-4", 28) },
    ]);
  });

  it.each([
    ["has no .scratch on its default branch", UNSCRATCHED],
    ["is one GitHub does not find", NOT_FOUND],
  ] as const)("leaves every Assigned PR Unfiled in a repository that %s", async (_, tree) => {
    const app = stunt(
      fakeGitHub([checkResponse(assignedFull)], LOCAL_MARKDOWN_TRACKER, {}, { "owner-2/repo-4": tree }),
    );

    await app.check();

    const model = await app.pageModel();
    expect(issueTrackers(model)).toMatchObject({ "owner-2/repo-4": "Local Markdown" });
    expect(groupsOf(model, "owner-2/repo-4")).toEqual([{ feature: null, prs: rows("owner-2/repo-4", 28, 27, 25) }]);
  });

  it("reads every Local Markdown repository without a clone in one query, and one with a clone only from its working tree", async () => {
    // owner-1/repo-2 has a clone whose working tree links #10420; its default
    // branch, here, links #25 and #27, which are not its PRs.
    const at = path.join(home(), "repos", "owner-1", "repo-2");
    await clone(at, "git@github.com:owner-1/repo-2.git", LOCAL_MARKDOWN_TRACKER["owner-2/repo-4"].object.text);
    await scratch(at, "oci-braintree/issues/01-skip-stripe-steps.md", "# 01. Skip Stripe steps\n\n**PR:** #10420\n");
    const github = fakeGitHub(
      [checkResponse(assignedFull)],
      { ...LOCAL_MARKDOWN_TRACKER, "owner-1/repo-3": LOCAL_MARKDOWN_TRACKER["owner-2/repo-4"] },
      {},
      { "owner-2/repo-4": SCRATCHED, "owner-1/repo-2": SCRATCHED },
    );
    const app = stunt(github);

    await app.check();

    const model = await app.pageModel();
    expect(groupsOf(model, "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10412, 9968) },
      { feature: "Oci braintree", prs: rows("owner-1/repo-2", 10420) },
    ]);
    expect(groupsOf(model, "owner-2/repo-4")).toEqual([
      { feature: null, prs: rows("owner-2/repo-4", 28) },
      { feature: "Cart pending changes", prs: rows("owner-2/repo-4", 25, 27) },
    ]);
    expect(github.scratchCalls).toHaveLength(1);
    const { variables } = github.scratchCalls[0];
    const asked = Object.keys(variables)
      .filter((key) => key.startsWith("owner"))
      .map((key) => `${variables[key]}/${variables[key.replace("owner", "name")]}`);
    expect(asked.toSorted()).toEqual(["owner-1/repo-3", "owner-2/repo-4"]);
  });

  it("asks GitHub for no .scratch tree when every Local Markdown repository has a clone", async () => {
    await clone(
      path.join(home(), "repos", "owner-2", "repo-4"),
      "git@github.com:owner-2/repo-4.git",
      LOCAL_MARKDOWN_TRACKER["owner-2/repo-4"].object.text,
    );
    const github = fakeGitHub([checkResponse(assignedFull)], { "owner-1/repo-2": DECLARED });

    await stunt(github).check();

    expect(github.scratchCalls).toEqual([]);
  });

  it("asks GitHub for no .scratch tree of a repository with only Review inbox PRs", async () => {
    // owner-1/repo-5 has Review inbox PRs and no Assigned PR.
    const github = fakeGitHub([checkResponse(assignedFull, inboxFull)], {
      "owner-1/repo-5": LOCAL_MARKDOWN_TRACKER["owner-2/repo-4"],
    });

    await stunt(github).check();

    expect(github.scratchCalls).toEqual([]);
  });

  it("fails a check on any other GitHub error reading a .scratch tree", async () => {
    const github = fakeGitHub([checkResponse(assignedFull)], LOCAL_MARKDOWN_TRACKER);
    const answer = github.graphql;
    github.graphql = async (query, variables) => {
      if (query.startsWith("query Scratch")) return { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] };
      return answer(query, variables);
    };

    await expect(stunt(github).check()).rejects.toThrow("API rate limit exceeded");
  });
});

describe("Feature grouping in a GitHub repository", () => {
  // owner-1/repo-2 has no clone and declares GitHub on its default branch.
  const GITHUB_TRACKER = { "owner-1/repo-2": DECLARED };

  // Gives a recorded PR `body`.
  function withBody(body: string) {
    return (pr: object) => Object.assign(pr, { body });
  }

  it("groups a PR under the parent, named after it, of the issue its body closes, with Unfiled first", async () => {
    const response = withPR(10420, withBody("## What\n\nThe change.\n\nCloses #12\n"));
    const app = stunt(
      fakeGitHub([checkResponse(response)], GITHUB_TRACKER, { "owner-1/repo-2#12": PARENTED }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10412, 9968) },
      { feature: "Feature 1", prs: rows("owner-1/repo-2", 10420) },
    ]);
  });

  it("makes an issue with no parent the Feature, named after it, of a PR whose body says it is part of it", async () => {
    const response = withPR(9968, withBody("Part of #1\n\n## What\n\nThe change.\n"));
    const app = stunt(
      fakeGitHub([checkResponse(response)], GITHUB_TRACKER, { "owner-1/repo-2#1": PARENTLESS }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10420, 10412) },
      { feature: "Feature 1", prs: rows("owner-1/repo-2", 9968) },
    ]);
  });

  it("orders a Feature's PRs by the order of its Tickets, a PR naming the Feature itself last", async () => {
    const response = structuredClone(assignedFull);
    // #10420 was updated last, #9968 first, but #3 comes before #12 among
    // Feature 1's Tickets.
    withBody("Closes #12")(response.data.assigned.nodes.find((pr) => pr.number === 10420) as object);
    withBody("Part of #1")(response.data.assigned.nodes.find((pr) => pr.number === 10412) as object);
    withBody("Closes #3")(response.data.assigned.nodes.find((pr) => pr.number === 9968) as object);
    const app = stunt(
      fakeGitHub([checkResponse(response)], GITHUB_TRACKER, {
        "owner-1/repo-2#12": PARENTED,
        "owner-1/repo-2#1": PARENTLESS,
        "owner-1/repo-2#3": { ...PARENTED, url: "https://github.com/owner-1/repo-2/issues/3", title: "Ticket 2" },
      }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: "Feature 1", prs: rows("owner-1/repo-2", 9968, 10420, 10412) },
    ]);
  });

  it("orders Features by name, ignoring case, numbers in it by value, and Features of one name by their most recently updated PR", async () => {
    const response = structuredClone(assignedFull);
    // #10420 was updated last, then #10412, then #9968.
    withBody("Closes #20")(response.data.assigned.nodes.find((pr) => pr.number === 10420) as object);
    withBody("Closes #12")(response.data.assigned.nodes.find((pr) => pr.number === 10412) as object);
    withBody("Closes #30")(response.data.assigned.nodes.find((pr) => pr.number === 9968) as object);
    // Ticket `ticket` under the Feature at issue `parent`, named `title`. Each
    // Feature keeps Feature 1's recorded Tickets, which order nothing here.
    const ticketUnder = (ticket: number, parent: number, title: string) => ({
      ...PARENTED,
      url: `https://github.com/owner-1/repo-2/issues/${ticket}`,
      title: `Ticket ${ticket}`,
      parent: { ...PARENTED.parent, url: `https://github.com/owner-1/repo-2/issues/${parent}`, title },
    });
    const app = stunt(
      fakeGitHub([checkResponse(response)], GITHUB_TRACKER, {
        "owner-1/repo-2#12": ticketUnder(12, 1, "feature 2"),
        "owner-1/repo-2#20": ticketUnder(20, 15, "Feature 2"),
        "owner-1/repo-2#30": ticketUnder(30, 16, "Feature 10"),
      }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: "Feature 2", prs: rows("owner-1/repo-2", 10420) },
      { feature: "feature 2", prs: rows("owner-1/repo-2", 10412) },
      { feature: "Feature 10", prs: rows("owner-1/repo-2", 9968) },
    ]);
  });

  it("groups the Review inbox by Feature the same way, Unfiled first, oldest request first", async () => {
    const inbox = inboxRows(await modelOf(checkResponse(assignedFull, inboxFull)), "owner-1/repo-2");
    const row = (number: number) => inbox.find((pr) => pr.number === number);
    const response = structuredClone(inboxFull);
    // #10404 was updated last, then #10306, then #10255, then #10419.
    withBody("Closes #20")(response.data.inbox.nodes.find((pr) => pr.number === 10404) as object);
    withBody("Closes #12")(response.data.inbox.nodes.find((pr) => pr.number === 10306) as object);
    withBody("Closes #3")(response.data.inbox.nodes.find((pr) => pr.number === 10419) as object);
    const app = stunt(
      fakeGitHub([checkResponse(assignedFull, response)], GITHUB_TRACKER, {
        "owner-1/repo-2#12": PARENTED,
        "owner-1/repo-2#3": { ...PARENTED, url: "https://github.com/owner-1/repo-2/issues/3", title: "Ticket 2" },
        "owner-1/repo-2#20": { ...PARENTLESS, url: "https://github.com/owner-1/repo-2/issues/20", title: "Feature 2" },
      }),
    );

    await app.check();

    const model = await app.pageModel();
    expect(model.repositories.find((repository) => repository.name === "owner-1/repo-2")?.reviewInbox).toEqual([
      { feature: null, prs: [row(10255)] },
      { feature: "Feature 1", prs: [row(10419), row(10306)] },
      { feature: "Feature 2", prs: [row(10404)] },
    ]);
  });

  it("asks GitHub for every Ticket the PRs of GitHub repositories name in one query, each once", async () => {
    const assigned = structuredClone(assignedFull);
    const inbox = structuredClone(inboxFull);
    withBody("Closes #12")(assigned.data.assigned.nodes.find((pr) => pr.number === 10420) as object);
    withBody("Part of #1")(assigned.data.assigned.nodes.find((pr) => pr.number === 10412) as object);
    withBody("Closes #12")(inbox.data.inbox.nodes.find((pr) => pr.number === 10419) as object);
    // owner-2/repo-4 declares no Issue tracker.
    withBody("Closes #12")(assigned.data.assigned.nodes.find((pr) => pr.number === 25) as object);
    const github = fakeGitHub([checkResponse(assigned, inbox)], GITHUB_TRACKER, {
      "owner-1/repo-2#12": PARENTED,
      "owner-1/repo-2#1": PARENTLESS,
    });

    await stunt(github).check();

    expect(github.ticketCalls).toHaveLength(1);
    const { variables } = github.ticketCalls[0];
    const asked = Object.keys(variables)
      .filter((key) => key.startsWith("owner"))
      .map((key) => `${variables[key]}/${variables[key.replace("owner", "name")]}#${variables[key.replace("owner", "number")]}`);
    expect(asked.toSorted()).toEqual(["owner-1/repo-2#1", "owner-1/repo-2#12"]);
  });

  it("asks GitHub for no Ticket when no PR names one", async () => {
    const github = fakeGitHub([checkResponse(assignedFull, inboxFull)], GITHUB_TRACKER);

    await stunt(github).check();

    expect(github.ticketCalls).toEqual([]);
  });

  it("links a PR by its first Closes or Part of line, in any case, and by no other mention of an issue", async () => {
    const response = structuredClone(assignedFull);
    withBody("Fixes #12\n\nThis closes #12, see Closes #12.\n\n- Closes #12\n\nCloses owner-1/repo-2#12\n")(
      response.data.assigned.nodes.find((pr) => pr.number === 10420) as object,
    );
    withBody("## What\n\nPart of #1\nCloses #12\n")(response.data.assigned.nodes.find((pr) => pr.number === 10412) as object);
    withBody("closes #12\n")(response.data.assigned.nodes.find((pr) => pr.number === 9968) as object);
    const github = fakeGitHub([checkResponse(response)], GITHUB_TRACKER, {
      "owner-1/repo-2#1": PARENTLESS,
      "owner-1/repo-2#12": PARENTED,
    });
    const app = stunt(github);

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10420) },
      { feature: "Feature 1", prs: rows("owner-1/repo-2", 9968, 10412) },
    ]);
  });

  it("leaves a PR Unfiled when GitHub does not find the issue its body names", async () => {
    const response = withPR(10420, withBody("Closes #99999"));
    const app = stunt(
      fakeGitHub([checkResponse(response)], GITHUB_TRACKER, { "owner-1/repo-2#99999": NOT_FOUND }),
    );

    await app.check();

    expect(groupsOf(await app.pageModel(), "owner-1/repo-2")).toEqual([
      { feature: null, prs: rows("owner-1/repo-2", 10420, 10412, 9968) },
    ]);
  });

  it("fails a check on any other GitHub error reading Tickets", async () => {
    const response = withPR(10420, withBody("Closes #12"));
    const github = fakeGitHub([checkResponse(response)], GITHUB_TRACKER);
    const answer = github.graphql;
    github.graphql = async (query, variables) => {
      if (query.startsWith("query Tickets")) return { errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] };
      return answer(query, variables);
    };

    await expect(stunt(github).check()).rejects.toThrow("API rate limit exceeded");
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

    const { stop } = await stunt(github).start();
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

    const { stop } = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(119_999);
    expect(github.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await checked(github, 2);

    stop();
  });

  it("tells the listener each check's Notifications, once the check is stored", async () => {
    const inbox = inboxHolding(368);
    const github = fakeGitHub([checkResponse(NO_ASSIGNED, inbox), checkResponse(NO_ASSIGNED, inbox)]);
    const app = stunt(github);
    const heard: { titles: string[]; repositories: number }[] = [];

    const { stop } = await app.start(async (notifications) => {
      const model = await app.pageModel();
      heard.push({
        titles: notifications.map((notification) => notification.title),
        repositories: model.repositories.length,
      });
    });
    await checked(github, 1);
    await until(() => heard.length === 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await checked(github, 2);
    await until(() => heard.length === 2);

    expect(heard).toEqual([
      { titles: ["owner-1/repo-3: 1 new Review request"], repositories: 1 },
      { titles: [], repositories: 1 },
    ]);
    stop();
  });

  it("keeps checking after a check fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const github = fakeGitHub([]);

    const { stop } = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(60_000);
    await checked(github, 2);

    expect(logged).toHaveBeenCalledWith("stunt: check failed:", expect.any(Error));
    stop();
  });

  it("checks now when asked to, without waiting for the interval", async () => {
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull)]);

    const { stop, checkNow } = await stunt(github).start();
    await checked(github, 1);
    await checkNow();

    expect(github.calls).toHaveLength(2);
    stop();
  });

  it("checks next one interval after checking now", async () => {
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull), checkResponse(assignedFull)]);

    const { stop, checkNow } = await stunt(github).start();
    await checked(github, 1);
    await vi.advanceTimersByTimeAsync(30_000);
    await checkNow();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(github.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await checked(github, 3);

    stop();
  });

  it("joins the check running when asked to check now", async () => {
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull)]);
    const heard: number[] = [];

    const { stop, checkNow } = await stunt(github).start(() => heard.push(github.calls.length));
    await checkNow();

    expect(github.calls).toHaveLength(1);
    expect(heard).toEqual([1]);
    expect(vi.getTimerCount()).toBe(1);
    stop();
  });

  it("fails to check now when the check fails, and keeps checking", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const github = fakeGitHub([checkResponse(assignedFull)]);

    const { stop, checkNow } = await stunt(github).start();
    await checked(github, 1);

    await expect(checkNow()).rejects.toThrow("no recorded response left");
    expect(vi.getTimerCount()).toBe(1);
    stop();
  });

  it("refuses to check now once stopped", async () => {
    const github = fakeGitHub([checkResponse(assignedFull), checkResponse(assignedFull)]);

    const { stop, checkNow } = await stunt(github).start();
    await checked(github, 1);
    stop();

    await expect(checkNow()).rejects.toThrow("checking has stopped");
    expect(github.calls).toHaveLength(1);
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
