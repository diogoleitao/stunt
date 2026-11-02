import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/config.ts";
import { ifExists } from "../fs.ts";

// How many directories below the clone root a clone is looked for: up to
// 4, one more than ~/repos/owner/group/repo.
const MAX_DEPTH = 4;

// The `owner/repo` of a github.com remote URL, in any of git's forms:
// git@github.com:owner/repo.git, https://github.com/owner/repo, or
// ssh://git@github.com/owner/repo.git.
const GITHUB_URL =
  /^(?:[\w.-]+@github\.com:|(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i;

// The URL of the `origin` remote in a git config file.
function originURL(config: string): string | undefined {
  let inOrigin = false;
  for (const line of config.split(/\r?\n/)) {
    const section = /^\s*\[(.*)\]\s*$/.exec(line);
    if (section !== null) {
      inOrigin = /^remote\s+"origin"$/.test(section[1].trim());
      continue;
    }
    const url = inOrigin ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
    if (url !== null) return url[1];
  }
  return undefined;
}

// The key a repository's clone is found by: its `owner/repo`, lowercased,
// because GitHub's names ignore case.
export function cloneKey(repository: string): string {
  return repository.toLowerCase();
}

// Whether `dir` is a clone: it holds a `.git` directory.
export async function isClone(dir: string): Promise<boolean> {
  return (await ifExists(stat(path.join(dir, ".git"))))?.isDirectory() ?? false;
}

// The clones below `root`, by the key of their `origin`'s `owner/repo`. A
// directory holding a `.git` directory is a clone, and nothing below it is
// looked at; a worktree or submodule, whose `.git` is a file, is not one.
// Hidden directories and node_modules are skipped. When two clones share an
// origin, the first in name order wins. A missing root holds no clones.
export async function findClones(root: string): Promise<Map<string, string>> {
  const clones = new Map<string, string>();

  async function visit(dir: string, depth: number): Promise<void> {
    const entries = await ifExists(readdir(dir, { withFileTypes: true }));
    if (entries === undefined) return;
    if (entries.some((entry) => entry.name === ".git" && entry.isDirectory())) {
      const config = await ifExists(readFile(path.join(dir, ".git", "config"), "utf8"));
      const url = config === undefined ? undefined : originURL(config);
      const repository = url === undefined ? undefined : GITHUB_URL.exec(url)?.[1];
      if (repository !== undefined && !clones.has(cloneKey(repository))) clones.set(cloneKey(repository), dir);
      return;
    }
    if (depth === MAX_DEPTH) return;
    const children = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .map((entry) => entry.name)
      .sort();
    for (const child of children) await visit(path.join(dir, child), depth + 1);
  }

  await visit(root, 0);
  return clones;
}

// The clones below the clone root, by key, and the clones the config names.
// A clone the config names wins over the scan, unless it is not a clone,
// which is warned about and left out.
export async function locateClones({
  cloneRoot,
  clones: configured,
}: Pick<Config, "cloneRoot" | "clones">): Promise<Map<string, string>> {
  const clones = await findClones(cloneRoot);
  for (const [repository, clone] of Object.entries(configured)) {
    if (await isClone(clone)) clones.set(cloneKey(repository), clone);
    else console.warn(`stunt: the clone of ${repository} in the config, ${clone}, is not a git clone`);
  }
  return clones;
}
