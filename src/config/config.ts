import { readFile } from "node:fs/promises";
import path from "node:path";
import { ifExists } from "../fs.ts";

export type Config = {
  checkIntervalSeconds: number;
};

const DEFAULTS: Config = {
  checkIntervalSeconds: 60,
};

export class ConfigError extends Error {}

export function defaultConfigPath(home: string): string {
  return path.join(home, ".config", "stunt", "config.json");
}

// A missing file, or a missing setting, gives the default.
export async function readConfig(configPath: string): Promise<Config> {
  const text = await ifExists(readFile(configPath, "utf8"));
  if (text === undefined) return DEFAULTS;

  let stored: unknown;
  try {
    stored = JSON.parse(text);
  } catch {
    throw new ConfigError(`config file ${configPath} is not valid JSON`);
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new ConfigError(`config file ${configPath} must hold a JSON object`);
  }

  const { checkIntervalSeconds = DEFAULTS.checkIntervalSeconds } = stored as Record<string, unknown>;
  if (
    typeof checkIntervalSeconds !== "number" ||
    !Number.isInteger(checkIntervalSeconds) ||
    checkIntervalSeconds < 1
  ) {
    throw new ConfigError(
      `config file ${configPath}: checkIntervalSeconds must be a whole number of seconds above 0`,
    );
  }
  return { checkIntervalSeconds };
}
