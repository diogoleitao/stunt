import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitHubClient } from "../github/client.ts";
import { openStunt } from "./stunt.ts";
// Recorded from the real query against a live account, then stripped of
// logins, owners, repository names, and titles. The two pages were recorded
// with a page size of 5.
import assignedFull from "./fixtures/assigned-prs-full.json" with { type: "json" };
import assignedPage1 from "./fixtures/assigned-prs-page-1.json" with { type: "json" };
import assignedPage2 from "./fixtures/assigned-prs-page-2.json" with { type: "json" };

const NOW = new Date("2026-11-01T12:00:00Z");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "stunt-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type GraphQLCall = { query: string; variables: Record<string, unknown> };

// Replays recorded response bodies in order, one per query.
function fakeGitHub(responses: unknown[]): GitHubClient & { calls: GraphQLCall[] } {
  const queue = [...responses];
  const calls: GraphQLCall[] = [];
  return {
    calls,
    async graphql(query, variables) {
      calls.push({ query, variables });
      if (queue.length === 0) throw new Error("no recorded response left");
      return structuredClone(queue.shift());
    },
  };
}

function configPath() {
  return path.join(dir, "config", "config.json");
}

function stunt(github: GitHubClient) {
  return openStunt({
    github,
    dataDir: path.join(dir, "data"),
    configPath: configPath(),
    clock: { now: () => NOW },
  });
}

async function writeConfig(config: unknown) {
  await mkdir(path.dirname(configPath()), { recursive: true });
  await writeFile(configPath(), JSON.stringify(config));
}

// The recorded full response, without the PRs that were merged or closed.
function withoutPRs(...numbers: number[]) {
  const response = structuredClone(assignedFull);
  response.data.assigned.nodes = response.data.assigned.nodes.filter(
    (node) => !numbers.includes(node.number),
  );
  return response;
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
      assignedPRs: [
        {
          number: 136,
          title: "Assigned PR 1",
          url: "https://github.com/owner-1/repo-1/pull/136",
          author: "user-1",
          updatedAgo: "15 days ago",
        },
      ],
    },
    {
      name: "owner-1/repo-2",
      assignedPRs: [
        {
          number: 10420,
          title: "Assigned PR 3",
          url: "https://github.com/owner-1/repo-2/pull/10420",
          author: "user-1",
          updatedAgo: "1 day ago",
        },
        {
          number: 10412,
          title: "Assigned PR 2",
          url: "https://github.com/owner-1/repo-2/pull/10412",
          author: "user-1",
          updatedAgo: "2 days ago",
        },
        {
          number: 9968,
          title: "Assigned PR 4",
          url: "https://github.com/owner-1/repo-2/pull/9968",
          author: "user-1",
          updatedAgo: "15 days ago",
        },
      ],
    },
    {
      name: "owner-1/repo-3",
      assignedPRs: [
        // A draft when recorded: Assigned PRs include drafts.
        {
          number: 381,
          title: "Assigned PR 5",
          url: "https://github.com/owner-1/repo-3/pull/381",
          author: "user-1",
          updatedAgo: "5 days ago",
        },
      ],
    },
    {
      name: "owner-2/repo-4",
      assignedPRs: [
        {
          number: 28,
          title: "Assigned PR 8",
          url: "https://github.com/owner-2/repo-4/pull/28",
          author: "user-1",
          updatedAgo: "18 hours ago",
        },
        {
          number: 27,
          title: "Assigned PR 7",
          url: "https://github.com/owner-2/repo-4/pull/27",
          author: "user-1",
          updatedAgo: "19 hours ago",
        },
        {
          number: 25,
          title: "Assigned PR 6",
          url: "https://github.com/owner-2/repo-4/pull/25",
          author: "user-1",
          updatedAgo: "20 hours ago",
        },
      ],
    },
  ],
};

describe("a check", () => {
  it("lists every repository with an Assigned PR, and its Assigned PRs, most recently updated first", async () => {
    const app = stunt(fakeGitHub([assignedFull]));

    await app.check();

    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("makes one query when the first page holds every Assigned PR", async () => {
    const github = fakeGitHub([assignedFull]);

    await stunt(github).check();

    expect(github.calls).toHaveLength(1);
    expect(github.calls[0].query).toContain("assignee:@me");
  });

  it("follows the next page when a page overflows", async () => {
    const github = fakeGitHub([assignedPage1, assignedPage2]);
    const app = stunt(github);

    await app.check();

    expect(github.calls.map((call) => call.variables.after)).toEqual([null, "Y3Vyc29yOjU="]);
    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("drops a PR merged or closed since the last check, and a repository left with none", async () => {
    const app = stunt(fakeGitHub([assignedFull, withoutPRs(10412, 136)]));

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
    const app = stunt(fakeGitHub([lagging]));

    await app.check();

    expect(await app.pageModel()).toEqual(await modelOf(withoutPRs(10412, 136)));
  });

  it("keeps what the last check saw across restarts", async () => {
    await stunt(fakeGitHub([assignedFull])).check();

    expect(await stunt(fakeGitHub([])).pageModel()).toEqual(ALL_ASSIGNED);
  });

  it("shows nothing before the first check", async () => {
    expect(await stunt(fakeGitHub([])).pageModel()).toEqual({ repositories: [] });
  });

  it("keeps the last check's PRs when a check fails", async () => {
    const app = stunt(fakeGitHub([assignedFull]));

    await app.check();
    await expect(app.check()).rejects.toThrow("no recorded response left");

    expect(await app.pageModel()).toEqual(ALL_ASSIGNED);
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
    const github = fakeGitHub([assignedFull, assignedFull]);

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
    const github = fakeGitHub([assignedFull, assignedFull]);

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
