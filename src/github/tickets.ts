import type { GitHubClient } from "./client.ts";
import { dataOf, type GraphQLError, issueParameters, issueVariables } from "./graphql.ts";
import type { PRRef } from "./prs.ts";

// An issue a PR's body names as its Ticket, with its parent issue, if any,
// and the parent's Tickets, its sub-issues on GitHub, in order, by their
// URLs.
export type TicketIssue = {
  url: string;
  title: string;
  parent: { url: string; title: string; subIssues: string[] } | null;
};

// Each issue in `tickets` by its repository and number, with its parent and
// the parent's first 100 Tickets.
function ticketsQuery(count: number): string {
  const variables = issueParameters(count);
  const tickets = Array.from({ length: count }, (_, i) => i)
    .map(
      (i) => `
  ticket${i}: repository(owner: $owner${i}, name: $name${i}) {
    issue(number: $number${i}) { ...Ticket }
  }`,
    )
    .join("");
  // The variable definitions without their leading comma.
  return `query Tickets(${variables.slice(2)}) {${tickets}
}

fragment Ticket on Issue {
  url
  title
  parent {
    url
    title
    subIssues(first: 100) {
      nodes { url }
    }
  }
}`;
}

type IssueNode = {
  url: string;
  title: string;
  parent: { url: string; title: string; subIssues: { nodes: { url: string }[] } } | null;
};

// A repository or issue GitHub does not find, or the viewer cannot see, is
// null, and so is a PR named as an issue.
type TicketsData = Record<`ticket${number}`, { issue: IssueNode | null } | null | undefined>;

function isTicketNotFound(error: GraphQLError): boolean {
  return error.type === "NOT_FOUND" && /^ticket\d+$/.test(String(error.path?.[0]));
}

// Where in a check's Tickets an issue is: its repository and number.
export function ticketKey({ repository, number }: PRRef): string {
  return `${repository}#${number}`;
}

// Each of `tickets`, by its repository and number, in one query, by
// `ticketKey`. An issue GitHub does not find is left out.
export async function fetchTickets(github: GitHubClient, tickets: PRRef[]): Promise<Map<string, TicketIssue>> {
  const issues = new Map<string, TicketIssue>();
  if (tickets.length === 0) return issues;
  const data = dataOf<TicketsData>(
    await github.graphql(ticketsQuery(tickets.length), issueVariables(tickets)),
    isTicketNotFound,
  );
  if (data === undefined) throw new Error("GitHub GraphQL response has no Tickets");
  tickets.forEach((ticket, i) => {
    const issue = data[`ticket${i}`]?.issue;
    if (issue === undefined || issue === null) return;
    issues.set(ticketKey(ticket), {
      url: issue.url,
      title: issue.title,
      parent:
        issue.parent === null
          ? null
          : {
              url: issue.parent.url,
              title: issue.parent.title,
              subIssues: issue.parent.subIssues.nodes.map((node) => node.url),
            },
    });
  });
  return issues;
}
