import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cloneKey } from "../clones/clones.ts";
import { ifExists } from "../fs.ts";
import type { AssignedPR } from "../github/prs.ts";
import type { IssueTracker } from "./issue-trackers.ts";

// A Ticket's link of PR `number` to the Feature the Ticket belongs to, by
// the Feature's slug.
export type FeatureLink = { number: number; featureSlug: string };

// A Ticket's file name, `NN-<slug>.md`, and its Ticket number.
const TICKET = /^(\d+)-.*\.md$/;

// The line by which a Ticket links a PR. Any other mention of a PR, such as
// `Stacked on #N` or `Shipped in PR #N`, does not link.
const PR_LINE = /^\*\*PR:\*\*\s+#(\d+)\b/gm;

// The names of the directories in `dir`, hidden ones left out, in name order.
async function directories(dir: string): Promise<string[]> {
  const entries = (await ifExists(readdir(dir, { withFileTypes: true }))) ?? [];
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

// The Tickets in `dir`, in Ticket number order.
async function tickets(dir: string): Promise<string[]> {
  const entries = (await ifExists(readdir(dir, { withFileTypes: true }))) ?? [];
  return entries
    .filter((entry) => entry.isFile() && TICKET.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(TICKET.exec(a)?.[1]) - Number(TICKET.exec(b)?.[1]) || a.localeCompare(b));
}

// The PRs the Tickets in the `.scratch` tree of the Local Markdown clone at
// `clone` link, in Feature slug order, then Ticket number order, then the
// order of a Ticket's PR lines. Features are `.scratch/<feature-slug>/` and
// Tickets are `.scratch/<feature-slug>/issues/NN-<slug>.md`. A PR two Tickets
// link stays with the first.
async function readTicketLinks(clone: string): Promise<FeatureLink[]> {
  const scratch = path.join(clone, ".scratch");
  const links = new Map<number, FeatureLink>();
  for (const featureSlug of await directories(scratch)) {
    const issues = path.join(scratch, featureSlug, "issues");
    for (const ticket of await tickets(issues)) {
      const text = await ifExists(readFile(path.join(issues, ticket), "utf8"));
      for (const [, pr] of text?.matchAll(PR_LINE) ?? []) {
        const number = Number(pr);
        if (!links.has(number)) links.set(number, { number, featureSlug });
      }
    }
  }
  return [...links.values()];
}

// The links of `assignedPRs` to Features, by repository, read from the clone
// among `clones` of each Local Markdown repository. A Local Markdown
// repository without a clone links none, so its PRs stay Unfiled.
export async function readFeatureLinks(
  assignedPRs: AssignedPR[],
  issueTrackers: Record<string, IssueTracker>,
  clones: Map<string, string>,
): Promise<Record<string, FeatureLink[]>> {
  const links: Record<string, FeatureLink[]> = {};
  for (const [repository, tracker] of Object.entries(issueTrackers)) {
    const clone = clones.get(cloneKey(repository));
    if (tracker !== "Local Markdown" || clone === undefined) continue;
    const assigned = new Set(assignedPRs.filter((pr) => pr.repository === repository).map((pr) => pr.number));
    links[repository] = (await readTicketLinks(clone)).filter((link) => assigned.has(link.number));
  }
  return links;
}
