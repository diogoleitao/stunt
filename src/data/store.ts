import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists, writeFileAtomically } from "../fs.ts";
import type { CheckedPRs } from "../github/prs.ts";

// What the last check saw. Before the first check there is no checkedAt and
// no PR.
export type State = CheckedPRs & {
  checkedAt?: string;
};

const EMPTY: State = { assignedPRs: [], reviewInbox: [] };

export function defaultDataDir(home: string): string {
  return path.join(home, ".local", "share", "stunt");
}

export function openStore(dataDir: string) {
  const statePath = path.join(dataDir, "state.json");
  return {
    async load(): Promise<State> {
      const text = await ifExists(readFile(statePath, "utf8"));
      if (text === undefined) return EMPTY;
      // A state saved before the Review inbox existed has none.
      return { ...EMPTY, ...(JSON.parse(text) as Partial<State>) };
    },

    async save(state: State): Promise<void> {
      await writeFileAtomically(statePath, `${JSON.stringify(state, null, 2)}\n`);
    },
  };
}
