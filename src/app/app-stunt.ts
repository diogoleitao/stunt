import { homedir } from "node:os";
import { defaultConfigPath } from "../config/config.ts";
import { defaultDataDir } from "../data/store.ts";
import { ghClient } from "../github/client.ts";
import type { Notification } from "../stunt/notifications.ts";
import { openStunt, type Schedule } from "../stunt/stunt.ts";

// The app's entry into stunt: the gh CLI's github.com account, the config
// under ~/.config/stunt/, the state under ~/.local/share/stunt/, the clones
// under ~/repos unless the config says otherwise, and the real clock.
export function appStunt() {
  const home = homedir();
  return openStunt({
    github: ghClient(),
    dataDir: defaultDataDir(home),
    configPath: defaultConfigPath(home),
    home,
    clock: { now: () => new Date() },
  });
}

// One stored check, for the tabs open when it ran: when it was sent to them,
// and the Notifications it made.
export type LiveUpdate = { sentAt: string; notifications: Notification[] };

type Listener = (update: LiveUpdate) => void;

const running = globalThis as { stuntSchedule?: Schedule; stuntListeners?: Set<Listener> };

// Kept on globalThis so the schedule and every open tab's stream share one
// set, across `next dev` reloads of this module too.
const listeners = (running.stuntListeners ??= new Set());

// Tells `listener` about every check from now on, until the returned function
// is called. Nothing is queued: a check made before it was added is never told.
export function listenToChecks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Starts the server's checks, once per process: `next dev` can load this
// module again without starting a second schedule.
export async function startChecking(): Promise<void> {
  if (running.stuntSchedule !== undefined) return;
  running.stuntSchedule = await appStunt().start((notifications) => {
    const update = { sentAt: new Date().toISOString(), notifications };
    for (const listener of listeners) listener(update);
  });
}

// Checks at once, joining the check running if there is one, and times the
// next check from its end. Rejects with the check's error, or when the
// server's checks have not started.
export async function checkNow(): Promise<void> {
  if (running.stuntSchedule === undefined) throw new Error("checking has not started");
  await running.stuntSchedule.checkNow();
}
