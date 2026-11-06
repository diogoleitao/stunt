import { locateClones } from "../clones/clones.ts";
import { readConfig } from "../config/config.ts";
import { openStore } from "../data/store.ts";
import type { GitHubClient } from "../github/client.ts";
import { fetchPRs, type ReviewInboxPR } from "../github/prs.ts";
import { readFeatureLinks } from "./features.ts";
import { readIssueTrackers } from "./issue-trackers.ts";
import { type Notification, notifications, reviewRequestId } from "./notifications.ts";
import { type PageModel, pageModel } from "./page-model.ts";

export type Clock = { now(): Date };

export type Schedule = { stop(): void; checkNow(): Promise<void>; checkRepository(repository: string): Promise<void> };

export type StuntOptions = {
  github: GitHubClient;
  dataDir: string;
  configPath: string;
  // The home directory, which holds the default clone root.
  home: string;
  clock: Clock;
};

// The key a repository is told apart by: its `owner/repo`, lowercased,
// because GitHub's names ignore case.
function repositoryKey(repository: string): string {
  return repository.toLowerCase();
}

export function openStunt({ github, dataDir, configPath, home, clock }: StuntOptions) {
  const store = openStore(dataDir);

  // Asks GitHub once for what changed, of `repository` alone when given, and
  // reads the Issue tracker of each repository it saw and the Features its PRs
  // ship.
  async function look(repository?: string) {
    const config = await readConfig(configPath, home);
    const prs = await fetchPRs(github, repository);
    const repositories = new Set([...prs.assignedPRs, ...prs.reviewInbox].map((pr) => pr.repository));
    const clones = await locateClones(config);
    const issueTrackers = await readIssueTrackers(github, [...repositories], clones);
    const featureLinks = await readFeatureLinks(github, prs, issueTrackers, clones);
    return { prs, issueTrackers, featureLinks };
  }

  // Looks at every repository and stores what it saw. Resolves to the
  // Notifications announcing the Review requests not announced before.
  async function check(): Promise<Notification[]> {
    const checkedAt = clock.now().toISOString();
    const { prs, issueTrackers, featureLinks } = await look();
    let unannounced: ReviewInboxPR[] = [];
    await store.update((state) => {
      const announced = new Set(state.announced);
      unannounced = prs.reviewInbox.filter((pr) => !announced.has(reviewRequestId(pr)));
      return { checkedAt, ...prs, announced: prs.reviewInbox.map(reviewRequestId), issueTrackers, featureLinks };
    });
    return notifications(unannounced);
  }

  // A Repository check: looks at `repository`, as `owner/repo`, and stores
  // what it saw of it in place of what the last check saw of it, leaving every
  // other repository and the check time as they were. Resolves to the
  // Notifications announcing its Review requests not announced before.
  async function checkRepository(repository: string): Promise<Notification[]> {
    const { prs, issueTrackers, featureLinks } = await look(repository);
    const other = (name: string) => repositoryKey(name) !== repositoryKey(repository);
    const others = <Value>(byRepository: Record<string, Value>) =>
      Object.fromEntries(Object.entries(byRepository).filter(([name]) => other(name)));
    let unannounced: ReviewInboxPR[] = [];
    await store.update((state) => {
      const announced = new Set(state.announced);
      unannounced = prs.reviewInbox.filter((pr) => !announced.has(reviewRequestId(pr)));
      const otherInbox = state.reviewInbox.filter((pr) => other(pr.repository));
      const otherRequests = new Set(otherInbox.map(reviewRequestId));
      return {
        ...state,
        assignedPRs: [...state.assignedPRs.filter((pr) => other(pr.repository)), ...prs.assignedPRs],
        reviewInbox: [...otherInbox, ...prs.reviewInbox],
        announced: [...state.announced.filter((id) => otherRequests.has(id)), ...prs.reviewInbox.map(reviewRequestId)],
        issueTrackers: { ...others(state.issueTrackers), ...issueTrackers },
        featureLinks: { ...others(state.featureLinks), ...featureLinks },
      };
    });
    return notifications(unannounced);
  }

  return {
    check,
    checkRepository,

    async pageModel(): Promise<PageModel> {
      return pageModel(await store.load(), clock.now());
    },

    // Checks now, then once per check interval, timed from the end of the
    // previous check so two never run at once, telling `onChecked` each
    // stored check's Notifications. A failed check, or a failure of
    // `onChecked`, is logged and the next check runs on time. Resolves to the
    // schedule: `stop` stops checking, `checkNow` checks at once, and
    // `checkRepository` makes a Repository check, telling `onChecked` its
    // Notifications too and leaving the next check on time.
    async start(onChecked: (notifications: Notification[]) => void = () => {}): Promise<Schedule> {
      const { checkIntervalSeconds } = await readConfig(configPath, home);
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      // The check running now, or waiting for the Repository checks running
      // to finish, which a check or Repository check asked for meanwhile
      // joins.
      let running: Promise<void> | undefined;

      // The Repository checks running now, by repository, which a Repository
      // check of the same repository asked for meanwhile joins. Those of
      // different repositories run at once.
      const repositoryChecks = new Map<string, Promise<void>>();

      // Checks with `checking`, then tells `onChecked` its Notifications.
      // Rejects with the check's error, logged after `failure`.
      const checkAndTell = async (checking: () => Promise<Notification[]>, failure: string) => {
        let notifications: Notification[];
        try {
          notifications = await checking();
        } catch (error) {
          console.error(failure, error);
          throw error;
        }
        try {
          onChecked(notifications);
        } catch (error) {
          console.error("stunt: telling a check's Notifications failed:", error);
        }
      };

      // Rejects with the check's error once the next check is scheduled.
      const run = async () => {
        try {
          // So a repository is never looked at by two checks at once. A
          // failed Repository check is its asker's to handle.
          await Promise.allSettled(repositoryChecks.values());
          await checkAndTell(check, "stunt: check failed:");
        } finally {
          // Done before scheduling, so a check asked for from here on starts
          // anew instead of joining this one and cancelling the next.
          running = undefined;
          if (!stopped) timer = setTimeout(checkOnTime, checkIntervalSeconds * 1000);
        }
      };
      const runOnce = () => (running ??= run());

      // A failed check on time is already logged.
      const checkOnTime = () => void runOnce().catch(() => {});
      checkOnTime();

      return {
        stop() {
          stopped = true;
          clearTimeout(timer);
        },
        async checkNow() {
          if (stopped) throw new Error("checking has stopped");
          if (running === undefined) clearTimeout(timer);
          await runOnce();
        },
        async checkRepository(repository) {
          if (stopped) throw new Error("checking has stopped");
          // A check covers the repository too.
          if (running !== undefined) return running;
          const key = repositoryKey(repository);
          let checking = repositoryChecks.get(key);
          if (checking === undefined) {
            checking = checkAndTell(
              () => checkRepository(repository),
              `stunt: Repository check of ${repository} failed:`,
            ).finally(() => repositoryChecks.delete(key));
            repositoryChecks.set(key, checking);
          }
          await checking;
        },
      };
    },
  };
}
