import { describe, expect, it } from "vitest";
import { switcherRows } from "./switcher-rows.ts";

const NAMES = ["owner-2/stunt", "owner-1/web", "stunt-org/api", "owner-1/stunt-cli"];

function namesOf(query: string) {
  return switcherRows({ names: NAMES, query }).map((row) => row.name);
}

describe("the switcher's rows", () => {
  it("lists every repository by name with an empty query", () => {
    expect(namesOf("")).toEqual(["owner-1/stunt-cli", "owner-1/web", "owner-2/stunt", "stunt-org/api"]);
  });

  it("keeps, by name, the repositories whose owner/repo contains the query, ignoring case and surrounding spaces", () => {
    expect(namesOf("  STUNT ")).toEqual(["owner-1/stunt-cli", "owner-2/stunt", "stunt-org/api"]);
    expect(namesOf("1/w")).toEqual(["owner-1/web"]);
  });

  it("lists nothing when no repository matches", () => {
    expect(namesOf("nope")).toEqual([]);
  });

  it("gives rows one to nine the shortcuts 1 to 9, the tenth 0, and the rest none", () => {
    const names = Array.from({ length: 12 }, (_, index) => `owner/repo-${String(index + 1).padStart(2, "0")}`);

    expect(switcherRows({ names, query: "" }).map((row) => [row.name, row.shortcut])).toEqual([
      ["owner/repo-01", "1"],
      ["owner/repo-02", "2"],
      ["owner/repo-03", "3"],
      ["owner/repo-04", "4"],
      ["owner/repo-05", "5"],
      ["owner/repo-06", "6"],
      ["owner/repo-07", "7"],
      ["owner/repo-08", "8"],
      ["owner/repo-09", "9"],
      ["owner/repo-10", "0"],
      ["owner/repo-11", undefined],
      ["owner/repo-12", undefined],
    ]);
  });

  it("numbers the rows a query leaves visible", () => {
    expect(switcherRows({ names: NAMES, query: "stunt" }).map((row) => row.shortcut)).toEqual(["1", "2", "3"]);
  });

  it("marks the current repository, numbered like any other row", () => {
    const rows = switcherRows({ names: NAMES, query: "", current: "owner-1/web" });

    expect(rows.map((row) => [row.name, row.shortcut, row.current])).toEqual([
      ["owner-1/stunt-cli", "1", false],
      ["owner-1/web", "2", true],
      ["owner-2/stunt", "3", false],
      ["stunt-org/api", "4", false],
    ]);
  });

  it("marks no repository off a repository page", () => {
    expect(switcherRows({ names: NAMES, query: "" }).map((row) => row.current)).toEqual([false, false, false, false]);
  });
});
