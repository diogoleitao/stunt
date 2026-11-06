export type SwitcherRow = {
  // owner/repo.
  name: string;
  // Whether it is the repository whose page is open.
  current: boolean;
  // The digit that opens it with Cmd: 1 to 9 for the first nine rows, 0 for
  // the tenth, and unset for the rest.
  shortcut?: string;
};

// A command the switcher runs, listed while the query starts with ":".
export type CommandRow = {
  command: ":check";
  // What the command does where it runs, such as "Check owner/repo now", in
  // parts: plain text, or a name shown as code.
  description: (string | { code: string })[];
};

const SHORTCUTS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];

// The switcher's visible commands for `query`, or undefined when `query` does
// not start with ":" and repositories show instead. ":check" checks
// `current`, the repository whose page is open, or every repository off a
// repository page.
export function commandRows({ query, current }: { query: string; current?: string }): CommandRow[] | undefined {
  const needle = query.trim().toLowerCase();
  if (!needle.startsWith(":")) return undefined;
  const check: CommandRow = {
    command: ":check",
    description: current === undefined ? ["Check now"] : ["Check ", { code: current }, " now"],
  };
  return [check].filter((row) => row.command.includes(needle));
}

// The switcher's visible rows for `query`, by name, none when `query` starts
// with ":" and commands show instead. `current` is the repository whose page
// is open, if any.
export function switcherRows({
  names,
  query,
  current,
}: {
  names: string[];
  query: string;
  current?: string;
}): SwitcherRow[] {
  const needle = query.trim().toLowerCase();
  if (needle.startsWith(":")) return [];
  return names
    .filter((name) => name.toLowerCase().includes(needle))
    .toSorted((a, b) => a.localeCompare(b))
    .map((name, index) => ({ name, current: name === current, shortcut: SHORTCUTS[index] }));
}
