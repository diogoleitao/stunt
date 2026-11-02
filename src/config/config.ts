import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists } from "../fs.ts";

export type Config = {
  checkIntervalSeconds: number;
  // Where local clones are looked for.
  cloneRoot: string;
  // A clone path by `owner/repo`, taking precedence over the clone the scan
  // finds, for clones outside the clone root.
  clones: Record<string, string>;
};

function defaults(home: string): Config {
  return { checkIntervalSeconds: 60, cloneRoot: path.join(home, "repos"), clones: {} };
}

export class ConfigError extends Error {}

export function defaultConfigPath(home: string): string {
  return path.join(home, ".config", "stunt", "config.json");
}

// A path that is absolute, or starts at ~/ for the home directory, as an
// absolute path. Undefined for any other value.
function absolutePath(value: unknown, home: string): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "~" || value.startsWith("~/")) return path.join(home, value.slice(1));
  return path.isAbsolute(value) ? value : undefined;
}

const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;

// A missing file, or a missing setting, gives the default. Defaults under the
// home directory are under `home`, and so are paths starting at ~/.
export async function readConfig(configPath: string, home: string): Promise<Config> {
  const fallback = defaults(home);
  const text = await ifExists(readFile(configPath, "utf8"));
  if (text === undefined) return fallback;

  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    throw new ConfigError(`config file ${configPath} is not valid JSON`);
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new ConfigError(`config file ${configPath} must hold a JSON object`);
  }

  const {
    checkIntervalSeconds = fallback.checkIntervalSeconds,
    cloneRoot = fallback.cloneRoot,
    clones = fallback.clones,
  } = stored as Record<string, unknown>;
  if (
    typeof checkIntervalSeconds !== "number" ||
    !Number.isInteger(checkIntervalSeconds) ||
    checkIntervalSeconds < 1
  ) {
    throw new ConfigError(
      `config file ${configPath}: checkIntervalSeconds must be a whole number of seconds above 0`,
    );
  }

  const root = absolutePath(cloneRoot, home);
  if (root === undefined) {
    throw new ConfigError(`config file ${configPath}: cloneRoot must be an absolute path or start at ~/`);
  }

  const clonesError = new ConfigError(
    `config file ${configPath}: clones must map each "owner/repo" to an absolute path or one starting at ~/`,
  );
  if (typeof clones !== "object" || clones === null || Array.isArray(clones)) throw clonesError;
  const clonePaths: Record<string, string> = {};
  for (const [repository, clone] of Object.entries(clones)) {
    const clonePath = absolutePath(clone, home);
    if (!REPOSITORY.test(repository) || clonePath === undefined) throw clonesError;
    clonePaths[repository] = clonePath;
  }

  return { checkIntervalSeconds, cloneRoot: root, clones: clonePaths };
}
