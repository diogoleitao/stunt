import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { cloneKey } from "../clones/clones.ts";
import { ifExists } from "../fs.ts";
import type { GitHubClient } from "../github/client.ts";
import type { CheckedPRs, PRRef } from "../github/prs.ts";
import { fetchTickets, ticketKey } from "../github/tickets.ts";
import type { IssueTracker } from "./issue-trackers.ts";

// A Ticket's link of PR `number` to the Feature the Ticket belongs to, by
// the Feature's id, its slug or its issue's URL, and its name, with the
// Ticket's place in the Feature's Ticket order. The order is null when the
// Ticket is not among the Feature's Tickets, such as the Feature itself.
export type FeatureLink = { number: number; featureId: string; featureName: string; ticketOrder: number | null };

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

// A Feature's name from its slug: hyphens as spaces, first letter capital.
function featureName(slug: string): string {
  const words = slug.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The PRs the Tickets in the `.scratch` tree of the Local Markdown clone at
// `clone` link, in Feature slug order, then Ticket number order, then the
// order of a Ticket's PR lines, which is their Ticket order. Features are
// `.scratch/<feature-slug>/` and Tickets are
// `.scratch/<feature-slug>/issues/NN-<slug>.md`. A PR two Tickets link stays
// with the first.
async function readTicketLinks(clone: string): Promise<FeatureLink[]> {
  const scratch = path.join(clone, ".scratch");
  const links = new Map<number, FeatureLink>();
  for (const featureSlug of await directories(scratch)) {
    const issues = path.join(scratch, featureSlug, "issues");
    for (const ticket of await tickets(issues)) {
      const text = await ifExists(readFile(path.join(issues, ticket), "utf8"));
      for (const [, pr] of text?.matchAll(PR_LINE) ?? []) {
        const number = Number(pr);
        if (links.has(number)) continue;
        links.set(number, {
          number,
          featureId: featureSlug,
          featureName: featureName(featureSlug),
          ticketOrder: links.size,
        });
      }
    }
  }
  return [...links.values()];
}

// The links of the PRs in `prs` of each GitHub repository to the Feature
// their Ticket belongs to, by repository, asking GitHub for every Ticket in
// one query. A PR's body names its Ticket; the Feature is the Ticket's parent
// issue, or the Ticket itself when it has no parent. Ticket order is the
// order of the parent's Tickets, its sub-issues on GitHub. A Ticket GitHub
// does not find links nothing.
async function readIssueLinks(
  github: GitHubClient,
  prs: CheckedPRs,
  repositories: string[],
): Promise<Record<string, FeatureLink[]>> {
  // Each PR naming a Ticket, with the Ticket by its repository and number.
  const named = [...prs.assignedPRs, ...prs.reviewInbox].flatMap(({ repository, number, ticket }) =>
    ticket === null || !repositories.includes(repository) ? [] : [{ number, ticket: { repository, number: ticket } }],
  );
  const tickets = new Map<string, PRRef>(named.map(({ ticket }) => [ticketKey(ticket), ticket]));
  const issues = await fetchTickets(github, [...tickets.values()]);

  const links: Record<string, Map<number, FeatureLink>> = {};
  for (const pr of named) {
    const issue = issues.get(ticketKey(pr.ticket));
    if (issue === undefined) continue;
    const feature = issue.parent ?? issue;
    const order = issue.parent?.subIssues.indexOf(issue.url) ?? -1;
    (links[pr.ticket.repository] ??= new Map()).set(pr.number, {
      number: pr.number,
      featureId: feature.url,
      featureName: feature.title,
      ticketOrder: order === -1 ? null : order,
    });
  }
  return Object.fromEntries(Object.entries(links).map(([repository, byPR]) => [repository, [...byPR.values()]]));
}

// The links of the PRs in `prs` to Features, by repository. In each Local
// Markdown repository, only Assigned PRs are linked, read from its clone
// among `clones`; one without a clone links none, so its PRs stay Unfiled.
// In each GitHub repository, Assigned PRs and Review inbox PRs are linked.
export async function readFeatureLinks(
  github: GitHubClient,
  prs: CheckedPRs,
  issueTrackers: Record<string, IssueTracker>,
  clones: Map<string, string>,
): Promise<Record<string, FeatureLink[]>> {
  const links: Record<string, FeatureLink[]> = {};
  for (const [repository, tracker] of Object.entries(issueTrackers)) {
    const clone = clones.get(cloneKey(repository));
    if (tracker !== "Local Markdown" || clone === undefined) continue;
    const assigned = new Set(prs.assignedPRs.filter((pr) => pr.repository === repository).map((pr) => pr.number));
    links[repository] = (await readTicketLinks(clone)).filter((link) => assigned.has(link.number));
  }
  const githubRepositories = Object.entries(issueTrackers).flatMap(([repository, tracker]) =>
    tracker === "GitHub" ? [repository] : [],
  );
  return { ...links, ...(await readIssueLinks(github, prs, githubRepositories)) };
}
