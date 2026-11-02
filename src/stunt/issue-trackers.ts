import { readFile } from "node:fs/promises";
import path from "node:path";
import { cloneKey, findClones, isClone } from "../clones/clones.ts";
import type { Config } from "../config/config.ts";
import { ifExists } from "../fs.ts";
import type { GitHubClient } from "../github/client.ts";
import { fetchDeclarations } from "../github/declarations.ts";

// The Issue trackers whose Features stunt can group PRs under. A repository
// with any other tracker, or none declared, has every PR Unfiled.
export type IssueTracker = "GitHub" | "Local Markdown";

// Where a repository's Matt Pocock skills setup declares its Issue tracker.
const DECLARATION = "docs/agents/issue-tracker.md";

const TRACKERS = new Map<string, IssueTracker>([
  ["Issue tracker: GitHub", "GitHub"],
  ["Issue tracker: Local Markdown", "Local Markdown"],
]);

// The Issue tracker a declaration names in its title, its first heading
// after any frontmatter.
function declaredTracker(declaration: string): IssueTracker | undefined {
  const body = declaration.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const title = /^#\s+(.+?)\s*$/m.exec(body)?.[1];
  return title === undefined ? undefined : TRACKERS.get(title);
}

// The Issue tracker of each of `repositories` that declares one stunt
// groups by. The declaration is read from the working tree of the
// repository's local clone, so a declaration kept out of git still counts,
// and from its GitHub default branch only when it has no clone. A clone the
// config names wins over the scan, unless it is not a clone, which is
// warned about and left out.
export async function readIssueTrackers(
  github: GitHubClient,
  repositories: string[],
  { cloneRoot, clones: configured }: Pick<Config, "cloneRoot" | "clones">,
): Promise<Record<string, IssueTracker>> {
  const clones = await findClones(cloneRoot);
  for (const [repository, clone] of Object.entries(configured)) {
    if (await isClone(clone)) clones.set(cloneKey(repository), clone);
    else console.warn(`stunt: the clone of ${repository} in the config, ${clone}, is not a git clone`);
  }

  const declarations = new Map<string, string>();
  const withoutClone: string[] = [];
  for (const repository of repositories) {
    const clone = clones.get(cloneKey(repository));
    if (clone === undefined) {
      withoutClone.push(repository);
      continue;
    }
    const declaration = await ifExists(readFile(path.join(clone, DECLARATION), "utf8"));
    if (declaration !== undefined) declarations.set(repository, declaration);
  }
  for (const [repository, declaration] of await fetchDeclarations(github, withoutClone, DECLARATION)) {
    declarations.set(repository, declaration);
  }

  const trackers: Record<string, IssueTracker> = {};
  for (const [repository, declaration] of declarations) {
    const tracker = declaredTracker(declaration);
    if (tracker !== undefined) trackers[repository] = tracker;
  }
  return trackers;
}
