import { readConfig } from "../config/config.ts";
import { openStore } from "../data/store.ts";
import type { GitHubClient } from "../github/client.ts";
import { fetchPRs } from "../github/prs.ts";
import { type PageModel, pageModel } from "./page-model.ts";
import { applyCheck, trackedPRs, withTasksDone } from "./tasks.ts";

export type Clock = { now(): Date };

export type StuntOptions = {
  github: GitHubClient;
  dataDir: string;
  configPath: string;
  clock: Clock;
};

export function openStunt({ github, dataDir, configPath, clock }: StuntOptions) {
  const store = openStore(dataDir);

  // Asks GitHub once for what changed, stores what it saw, and turns new
  // activity into Tasks.
  async function check(): Promise<void> {
    const checkedAt = clock.now().toISOString();
    const { tasks, baseline } = await store.load();
    const prs = await fetchPRs(github, {
      lookups: trackedPRs(tasks),
      since: baseline,
      known: new Set(tasks.map((task) => task.id)),
    });
    await store.update((state) => applyCheck(state, prs, checkedAt));
  }

  return {
    check,

    // Marks open Tasks done, such as every Task of one PR at once. A Task
    // already done or expired stays as it is.
    async markDone(...ids: string[]): Promise<void> {
      await store.update((state) => withTasksDone(state, ids));
    },

    async pageModel(): Promise<PageModel> {
      return pageModel(await store.load(), clock.now());
    },

    // Checks now, then once per check interval, timed from the end of the
    // previous check so two never run at once. A failed check is logged and
    // the next one runs on time. Resolves to a function that stops checking.
    async start(): Promise<() => void> {
      const { checkIntervalSeconds } = await readConfig(configPath);
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const run = async () => {
        try {
          await check();
        } catch (error) {
          console.error("stunt: check failed:", error);
        }
        if (!stopped) timer = setTimeout(run, checkIntervalSeconds * 1000);
      };
      void run();

      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    },
  };
}
