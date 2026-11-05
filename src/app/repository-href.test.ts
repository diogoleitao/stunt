import { describe, expect, it } from "vitest";
import { repositoryHref } from "./repository-href.ts";

describe("a repository's page link", () => {
  it("opens the Assigned PRs tab with no tab or with assigned-prs", () => {
    expect(repositoryHref("owner/repo")).toBe("/repos/owner/repo");
    expect(repositoryHref("owner/repo", "assigned-prs")).toBe("/repos/owner/repo");
  });

  it("opens the Review inbox tab with review-inbox", () => {
    expect(repositoryHref("owner/repo", "review-inbox")).toBe("/repos/owner/repo?tab=review-inbox");
  });
});
