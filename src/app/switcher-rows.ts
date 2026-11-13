export type SwitcherRow = {
  // owner/repo.
  name: string;
  // Whether it is the repository whose page is open.
  current: boolean;
  // The digit that opens it with Cmd: 1 to 9 for the first nine rows, 0 for
  // the tenth, and unset for the rest.
  shortcut?: string;
}

const SHORTCUTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

// The switcher's visible rows for `query`, by name. `current` is the
// repository whose page is open, if any.
export function switcherRows ({
  names,
  query,
  current,
}: {
  names: string[];
  query: string;
  current?: string;
}): SwitcherRow[] {
  const needle = query.trim().toLowerCase()
  return names
    .filter((name) => name.toLowerCase().includes(needle))
    .toSorted((a, b) => a.localeCompare(b))
    .map((name, index) => ({ name, current: name === current, shortcut: SHORTCUTS[index] }))
}
