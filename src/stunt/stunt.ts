import { readConfig } from "../config/config.ts";
import { openStore } from "../data/store.ts";
import type { GitHubClient } from "../github/client.ts";
import { fetchPRs } from "../github/prs.ts";
import { readIssueTrackers } from "./issue-trackers.ts";
import { type Notification, notifications } from "./notifications.ts";
import { type PageModel, pageModel } from "./page-model.ts";
import { applyCheck, type Task, trackedPRs, withTasksDone } from "./tasks.ts";

export type Clock = { now(): Date };

export type StuntOptions = {
  github: GitHubClient;
  dataDir: string;
  configPath: string;
  // The home directory, which holds the default clone root.
  home: string;
  clock: Clock;
};

export function openStunt({ github, dataDir, configPath, home, clock }: StuntOptions) {
  const store = openStore(dataDir);

  // Asks GitHub once for what changed, reads the Issue tracker of each
  // repository it saw, stores what it saw, and turns new activity into
  // Tasks. Resolves to the Notifications announcing them.
  async function check(): Promise<Notification[]> {
    const checkedAt = clock.now().toISOString();
    const config = await readConfig(configPath, home);
    const { tasks, baseline } = await store.load();
    const prs = await fetchPRs(github, {
      lookups: trackedPRs(tasks),
      since: baseline,
      known: new Set(tasks.map((task) => task.id)),
    });
    const repositories = new Set([...prs.assignedPRs, ...prs.reviewInbox].map((pr) => pr.repository));
    const issueTrackers = await readIssueTrackers(github, [...repositories], config);
    let created: Task[] = [];
    await store.update((state) => {
      const next = { ...applyCheck(state, prs, checkedAt), issueTrackers };
      const known = new Set(state.tasks.map((task) => task.id));
      created = next.tasks.filter((task) => !known.has(task.id));
      return next;
    });
    return notifications(created);
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
    // previous check so two never run at once, telling `onChecked` each
    // stored check's Notifications. A failed check, or a failure of
    // `onChecked`, is logged and the next check runs on time. Resolves to a
    // function that stops checking.
    async start(onChecked: (notifications: Notification[]) => void = () => {}): Promise<() => void> {
      const { checkIntervalSeconds } = await readConfig(configPath, home);
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const run = async () => {
        let notifications: Notification[] | undefined;
        try {
          notifications = await check();
        } catch (error) {
          console.error("stunt: check failed:", error);
        }
        try {
          if (notifications !== undefined) onChecked(notifications);
        } catch (error) {
          console.error("stunt: telling a check's Notifications failed:", error);
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
