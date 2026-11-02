import { readConfig } from "../config/config.ts";
import { openStore } from "../data/store.ts";
import { fetchAssignedPRs } from "../github/assigned-prs.ts";
import type { GitHubClient } from "../github/client.ts";
import { type PageModel, pageModel } from "./page-model.ts";

export type Clock = { now(): Date };

export type StuntOptions = {
  github: GitHubClient;
  dataDir: string;
  configPath: string;
  clock: Clock;
};

export function openStunt({ github, dataDir, configPath, clock }: StuntOptions) {
  const store = openStore(dataDir);

  // Asks GitHub once for what changed and stores what it saw.
  async function check(): Promise<void> {
    const checkedAt = clock.now().toISOString();
    const assignedPRs = await fetchAssignedPRs(github);
    await store.save({ checkedAt, assignedPRs });
  }

  return {
    check,

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
