import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import type { AssignedPR } from "../github/assigned-prs.ts";

// What the last check saw. Before the first check there is no checkedAt and
// no Assigned PR.
export type State = {
  checkedAt?: string;
  assignedPRs: AssignedPR[];
};

export function defaultDataDir(home: string): string {
  return path.join(home, ".local", "share", "stunt");
}

export function openStore(dataDir: string) {
  const statePath = path.join(dataDir, "state.json");
  return {
    async load(): Promise<State> {
      const text = await ifExists(readFile(statePath, "utf8"));
      if (text === undefined) return { assignedPRs: [] };
      return JSON.parse(text) as State;
    },

    async save(state: State): Promise<void> {
      await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
    },
  };
}
