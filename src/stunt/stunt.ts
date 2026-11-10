import { locateClones } from '../clones/clones.ts'
import { readConfig } from '../config/config.ts'
import { openStore } from '../data/store.ts'
import type { GitHubClient } from '../github/client.ts'
import { fetchPRs, type ReviewInboxPR } from '../github/prs.ts'
import { readFeatureLinks } from './features.ts'
import { readIssueTrackers } from './issue-trackers.ts'
import { type Notification, notifications, reviewRequestId } from './notifications.ts'
import { type PageModel, pageModel } from './page-model.ts'

export type Clock = { now(): Date }

export type Schedule = { stop(): void; checkNow(): Promise<void> }

export type StuntOptions = {
  github: GitHubClient;
  dataDir: string;
  configPath: string;
  // The home directory, which holds the default clone root.
  home: string;
  clock: Clock;
}

export function openStunt ({ github, dataDir, configPath, home, clock }: StuntOptions) {
  const store = openStore(dataDir)

  // Asks GitHub once for what changed, reads the Issue tracker of each
  // repository it saw and the Features its PRs ship, and stores what it saw.
  // Resolves to the Notifications announcing the Review requests not
  // announced before.
  async function check (): Promise<Notification[]> {
    const checkedAt = clock.now().toISOString()
    const config = await readConfig(configPath, home)
    const prs = await fetchPRs(github)
    const repositories = new Set([...prs.assignedPRs, ...prs.reviewInbox].map((pr) => pr.repository))
    const clones = await locateClones(config)
    const issueTrackers = await readIssueTrackers(github, [...repositories], clones)
    const featureLinks = await readFeatureLinks(github, prs, issueTrackers, clones)
    let unannounced: ReviewInboxPR[] = []
    await store.update((state) => {
      const announced = new Set(state.announced)
      unannounced = prs.reviewInbox.filter((pr) => !announced.has(reviewRequestId(pr)))
      return { checkedAt, ...prs, announced: prs.reviewInbox.map(reviewRequestId), issueTrackers, featureLinks }
    })
    return notifications(unannounced)
  }

  return {
    check,

    async pageModel (): Promise<PageModel> {
      return pageModel(await store.load(), clock.now())
    },

    // Checks now, then once per check interval, timed from the end of the
    // previous check so two never run at once, telling `onChecked` each
    // stored check's Notifications. A failed check, or a failure of
    // `onChecked`, is logged and the next check runs on time. Resolves to the
    // schedule: `stop` stops checking, and `checkNow` checks at once.
    async start (onChecked: (notifications: Notification[]) => void = () => {}): Promise<Schedule> {
      const { checkIntervalSeconds } = await readConfig(configPath, home)
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined

      // The check running now, which a check asked for meanwhile joins.
      let running: Promise<void> | undefined

      // Rejects with the check's error once the next check is scheduled.
      const run = async () => {
        try {
          let notifications: Notification[]
          try {
            notifications = await check()
          } catch (error) {
            console.error('stunt: check failed:', error)
            throw error
          }
          try {
            onChecked(notifications)
          } catch (error) {
            console.error("stunt: telling a check's Notifications failed:", error)
          }
        } finally {
          // Done before scheduling, so a check asked for from here on starts
          // anew instead of joining this one and cancelling the next.
          running = undefined
          if (!stopped) timer = setTimeout(checkOnTime, checkIntervalSeconds * 1000)
        }
      }
      const runOnce = () => (running ??= run())

      // A failed check on time is already logged.
      const checkOnTime = () => { runOnce().catch(() => {}) }
      checkOnTime()

      return {
        stop () {
          stopped = true
          clearTimeout(timer)
        },
        async checkNow () {
          if (stopped) throw new Error('checking has stopped')
          if (running === undefined) clearTimeout(timer)
          await runOnce()
        },
      }
    },
  }
}
