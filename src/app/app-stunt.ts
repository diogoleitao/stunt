import { homedir } from "node:os";
import { defaultConfigPath } from "../config/config.ts";
import { defaultDataDir } from "../data/store.ts";
import { ghClient } from "../github/client.ts";
import { openStunt } from "../stunt/stunt.ts";

// The app's entry into stunt: the gh CLI's github.com account, the config
// under ~/.config/stunt/, the state under ~/.local/share/stunt/, and the real
// clock.
export function appStunt() {
  const home = homedir();
  return openStunt({
    github: ghClient(),
    dataDir: defaultDataDir(home),
    configPath: defaultConfigPath(home),
    clock: { now: () => new Date() },
  });
}

const running = globalThis as { stopStunt?: () => void };

// Starts the server's checks, once per process: `next dev` can load this
// module again without starting a second schedule.
export async function startChecking(): Promise<void> {
  if (running.stopStunt !== undefined) return;
  running.stopStunt = await appStunt().start();
}
