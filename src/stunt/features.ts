import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { cloneKey } from '../clones/clones.ts'
import { ifExists } from '../fs.ts'
import type { GitHubClient } from '../github/client.ts'
import type { CheckedPRs, PRRef } from '../github/prs.ts'
import { fetchScratchTrees, type ScratchTree } from '../github/scratch.ts'
import { fetchTickets, ticketKey } from '../github/tickets.ts'
import type { IssueTracker } from './issue-trackers.ts'

// A Ticket's link of PR `number` to the Feature the Ticket belongs to, by
// the Feature's id, its slug or its issue's URL, and its name, with the
// Ticket's place in the Feature's Ticket order. The order is null when the
// Ticket is not among the Feature's Tickets, such as the Feature itself.
export type FeatureLink = { number: number; featureId: string; featureName: string; ticketOrder: number | null }

// A Ticket's file name, `NN-<slug>.md`, and its Ticket number.
const TICKET = /^(\d+)-.*\.md$/

// The line by which a Ticket links a PR. Any other mention of a PR, such as
// `Stacked on #N` or `Shipped in PR #N`, does not link.
const PR_LINE = /^\*\*PR:\*\*\s+#(\d+)\b/gm

// Whether `slug`, a directory in `.scratch`, is a Feature: a hidden one is
// not.
function isFeature (slug: string): boolean {
  return !slug.startsWith('.')
}

// The names of the entries in `dir` that `wanted` keeps.
async function names (dir: string, wanted: (entry: Dirent) => boolean): Promise<string[]> {
  const found = (await ifExists(readdir(dir, { withFileTypes: true }))) ?? []
  return found.filter(wanted).map((entry) => entry.name)
}

// The `.scratch` tree in the working tree of the Local Markdown clone at
// `clone`, its Features holding only their Tickets.
async function readScratchTree (clone: string): Promise<ScratchTree> {
  const scratch = path.join(clone, '.scratch')
  const tree: ScratchTree = new Map()
  for (const featureSlug of await names(scratch, (entry) => entry.isDirectory() && isFeature(entry.name))) {
    const issues = path.join(scratch, featureSlug, 'issues')
    const texts = new Map<string, string>()
    for (const file of await names(issues, (entry) => entry.isFile() && TICKET.test(entry.name))) {
      const text = await ifExists(readFile(path.join(issues, file), 'utf8'))
      if (text !== undefined) texts.set(file, text)
    }
    tree.set(featureSlug, texts)
  }
  return tree
}

// A Feature's name from its slug: hyphens as spaces, first letter capital.
function featureName (slug: string): string {
  const words = slug.replaceAll('-', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The PRs the Tickets in the `.scratch` tree `tree` link, in Feature slug
// order, then Ticket number order, then the order of a Ticket's PR lines,
// which is their Ticket order. Features are `.scratch/<feature-slug>/`,
// hidden ones left out, and Tickets are
// `.scratch/<feature-slug>/issues/NN-<slug>.md`. A PR two Tickets link stays
// with the first.
function ticketLinks (tree: ScratchTree): FeatureLink[] {
  const links = new Map<number, FeatureLink>()
  const features = [...tree]
    .filter(([slug]) => isFeature(slug))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  for (const [featureSlug, texts] of features) {
    const tickets = [...texts.keys()]
      .filter((file) => TICKET.test(file))
      .sort((a, b) => Number(TICKET.exec(a)?.[1]) - Number(TICKET.exec(b)?.[1]) || a.localeCompare(b))
    for (const ticket of tickets) {
      for (const [, pr] of texts.get(ticket)?.matchAll(PR_LINE) ?? []) {
        const number = Number(pr)
        if (links.has(number)) continue
        links.set(number, {
          number,
          featureId: featureSlug,
          featureName: featureName(featureSlug),
          ticketOrder: links.size,
        })
      }
    }
  }
  return [...links.values()]
}

// The links of the PRs in `prs` of each GitHub repository to the Feature
// their Ticket belongs to, by repository, asking GitHub for every Ticket in
// one query. A PR's body names its Ticket; the Feature is the Ticket's parent
// issue, or the Ticket itself when it has no parent. Ticket order is the
// order of the parent's Tickets, its sub-issues on GitHub. A Ticket GitHub
// does not find links nothing.
async function readIssueLinks (
  github: GitHubClient,
  prs: CheckedPRs,
  repositories: string[]
): Promise<Record<string, FeatureLink[]>> {
  // Each PR naming a Ticket, with the Ticket by its repository and number.
  const named = [...prs.assignedPRs, ...prs.reviewInbox].flatMap(({ repository, number, ticket }) =>
    ticket === null || !repositories.includes(repository) ? [] : [{ number, ticket: { repository, number: ticket } }]
  )
  const tickets = new Map<string, PRRef>(named.map(({ ticket }) => [ticketKey(ticket), ticket]))
  const issues = await fetchTickets(github, [...tickets.values()])

  const links: Record<string, Map<number, FeatureLink>> = {}
  for (const pr of named) {
    const issue = issues.get(ticketKey(pr.ticket))
    if (issue === undefined) continue
    const feature = issue.parent ?? issue
    const order = issue.parent?.subIssues.indexOf(issue.url) ?? -1;
    (links[pr.ticket.repository] ??= new Map()).set(pr.number, {
      number: pr.number,
      featureId: feature.url,
      featureName: feature.title,
      ticketOrder: order === -1 ? null : order,
    })
  }
  return Object.fromEntries(Object.entries(links).map(([repository, byPR]) => [repository, [...byPR.values()]]))
}

// The repositories in `issueTrackers` whose Issue tracker is `tracker`.
function trackedBy (issueTrackers: Record<string, IssueTracker>, tracker: IssueTracker): string[] {
  return Object.entries(issueTrackers).flatMap(([repository, declared]) => (declared === tracker ? [repository] : []))
}

// The links of the PRs in `prs` to Features, by repository. In each Local
// Markdown repository with an Assigned PR, only Assigned PRs are linked,
// read from the working tree of its clone among `clones`, so Tickets kept
// out of git still link, and from its GitHub default branch only when it has
// no clone, asking GitHub for every such repository in one query. In each
// GitHub repository, Assigned PRs and Review inbox PRs are linked.
export async function readFeatureLinks (
  github: GitHubClient,
  prs: CheckedPRs,
  issueTrackers: Record<string, IssueTracker>,
  clones: Map<string, string>
): Promise<Record<string, FeatureLink[]>> {
  const localMarkdown = trackedBy(issueTrackers, 'Local Markdown').filter((repository) =>
    prs.assignedPRs.some((pr) => pr.repository === repository)
  )
  const withoutClone = localMarkdown.filter((repository) => !clones.has(cloneKey(repository)))
  const fetched = await fetchScratchTrees(github, withoutClone)
  const links: Record<string, FeatureLink[]> = {}
  for (const repository of localMarkdown) {
    const clone = clones.get(cloneKey(repository))
    const tree = clone === undefined ? fetched.get(repository) : await readScratchTree(clone)
    if (tree === undefined) continue
    const assigned = new Set(prs.assignedPRs.filter((pr) => pr.repository === repository).map((pr) => pr.number))
    links[repository] = ticketLinks(tree).filter((link) => assigned.has(link.number))
  }
  return { ...links, ...(await readIssueLinks(github, prs, trackedBy(issueTrackers, 'GitHub'))) }
}
