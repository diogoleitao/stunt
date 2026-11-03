import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import type { CheckedPRs } from "../github/prs.ts";
import type { FeatureLink } from "../stunt/features.ts";
import type { IssueTracker } from "../stunt/issue-trackers.ts";

// What the last check saw. Before the first check there is no checkedAt and
// no PR.
export type State = CheckedPRs & {
  checkedAt?: string;
  // The ids of the Review requests already announced, of those still in the
  // Review inbox, so none is announced twice.
  announced: string[];
  // The Issue tracker of each repository the last check saw that declares
  // one stunt groups by.
  issueTrackers: Record<string, IssueTracker>;
  // The links of each Local Markdown repository's Assigned PRs, and of each
  // GitHub repository's Assigned PRs and Review inbox PRs, to Features.
  featureLinks: Record<string, FeatureLink[]>;
};

const EMPTY: State = { assignedPRs: [], reviewInbox: [], announced: [], issueTrackers: {}, featureLinks: {} };

export function defaultDataDir(home: string): string {
  return path.join(home, ".local", "share", "stunt");
}

// The last change queued on each state file. Kept on globalThis so every
// store on one file takes turns, across `next dev` reloads of this module too.
const queues = ((globalThis as { stuntStateQueues?: Map<string, Promise<unknown>> }).stuntStateQueues ??=
  new Map());

export function openStore(dataDir: string) {
  const statePath = path.join(dataDir, "state.json");

  async function load(): Promise<State> {
    const text = await ifExists(readFile(statePath, "utf8"));
    if (text === undefined) return EMPTY;
    // A state saved before the Review inbox, announced Review requests, Issue
    // trackers, or Feature links existed has none. One saved while Tasks
    // existed holds Tasks and a Baseline, which are left out.
    const { tasks: _tasks, baseline: _baseline, ...stored } = JSON.parse(text) as Partial<State> & {
      tasks?: unknown;
      baseline?: unknown;
    };
    return { ...EMPTY, ...stored };
  }

  return {
    load,

    // Loads the state, changes it, and saves it, after every change queued
    // before it, so two changes never overwrite each other.
    update(change: (state: State) => State): Promise<void> {
      const previous = queues.get(statePath) ?? Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(async () => {
          const state = change(await load());
          await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
        });
      queues.set(statePath, next);
      return next;
    },
  };
}
