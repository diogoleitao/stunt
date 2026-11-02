import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Runs one GraphQL query against github.com, giving the response body as
// parsed JSON, `errors` included. Tests swap in a client that replays
// recorded bodies.
export type GitHubClient = {
  graphql(query: string, variables: Record<string, unknown>): Promise<unknown>;
};

const run = promisify(execFile);

// The token of the gh CLI's active github.com account, read on every query so
// switching accounts with `gh auth switch` takes effect at the next check.
async function ghToken(): Promise<string> {
  const { stdout } = await run("gh", ["auth", "token", "--hostname", "github.com"]);
  return stdout.trim();
}

export function ghClient(): GitHubClient {
  return {
    async graphql(query, variables) {
      const response = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await ghToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) {
        throw new Error(`GitHub GraphQL request failed: ${response.status} ${response.statusText}`);
      }
      return response.json();
    },
  };
}
