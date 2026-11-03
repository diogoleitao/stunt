"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { type KeyboardEvent, useEffect, useEffectEvent, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { repositoryHref } from "./repository-href.ts";
import { switcherRows } from "./switcher-rows.ts";

// The Cmd+K switcher over every repository, by full name. Escape closes it.
export function RepositorySwitcher({ names }: { names: string[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function toggleOnCmdK(event: globalThis.KeyboardEvent) {
      if (event.metaKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
    }
    window.addEventListener("keydown", toggleOnCmdK);
    return () => window.removeEventListener("keydown", toggleOnCmdK);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-[20vh] left-1/2 z-50 w-full max-w-lg -translate-x-1/2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg"
        >
          <Dialog.Title className="sr-only">Switch repository</Dialog.Title>
          <RepositoryPicker names={names} onPick={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// How long Cmd is held on its own before the rows show their shortcuts.
const HINT_DELAY_MS = 1000;

// Cmd with the digit key of a row's shortcut opens that row, keyed by the
// physical key so the keyboard layout does not matter.
const SHORTCUT_CODES: Record<string, string> = {
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  Digit0: "0",
};

// Filters the repositories by owner/repo as you type, moves the selection with
// the arrow keys, and opens the selected repository's page on Enter, or a
// row's page on Cmd and its digit. Holding Cmd on its own shows each row's
// digit. Mounted only while the switcher is open, so every opening starts from
// an empty query, and Cmd and its digits are only taken while it is open.
function RepositoryPicker({ names, onPick }: { names: string[]; onPick: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const listId = useId();
  const [query, setQuery] = useState("");
  // Held by name so a live refresh that reorders the repositories keeps the
  // same one selected; the first match is selected when it is gone or unset.
  const [selectedName, setSelectedName] = useState<string>();
  const [hintShown, setHintShown] = useState(false);

  const current = names.find((name) => pathname === repositoryHref(name));
  const rows = switcherRows({ names, query, current });
  const selectedIndex = Math.max(0, rows.findIndex((row) => row.name === selectedName));

  function openRepository(name: string) {
    onPick();
    router.push(repositoryHref(name));
  }

  const openShortcut = useEffectEvent((shortcut: string) => {
    const row = rows.find((candidate) => candidate.shortcut === shortcut);
    if (row !== undefined) openRepository(row.name);
  });

  useEffect(() => {
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    function hideHint() {
      clearTimeout(hintTimer);
      hintTimer = undefined;
      setHintShown(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "Meta") {
        hintTimer ??= setTimeout(() => setHintShown(true), HINT_DELAY_MS);
        return;
      }
      hideHint();
      const shortcut = SHORTCUT_CODES[event.code];
      if (!event.metaKey || shortcut === undefined) return;
      // Even with no row to open, so the browser does not switch tabs.
      event.preventDefault();
      openShortcut(shortcut);
    }
    function onKeyUp(event: globalThis.KeyboardEvent) {
      if (event.key === "Meta") hideHint();
    }
    // Cmd released in another window never reaches this one.
    window.addEventListener("blur", hideHint);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      clearTimeout(hintTimer);
      window.removeEventListener("blur", hideHint);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  function navigateRows(event: KeyboardEvent<HTMLInputElement>) {
    if (rows.length === 0 || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedName(rows[(selectedIndex + 1) % rows.length].name);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedName(rows[(selectedIndex - 1 + rows.length) % rows.length].name);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openRepository(rows[selectedIndex].name);
    }
  }

  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={rows.length > 0 ? optionId(selectedIndex) : undefined}
          aria-label="Repository"
          placeholder="owner/repo"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedName(undefined);
          }}
          onKeyDown={navigateRows}
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Repositories" className="max-h-80 overflow-y-auto p-1">
        {rows.map((row, index) => (
          <li
            key={row.name}
            id={optionId(index)}
            role="option"
            aria-selected={index === selectedIndex}
            aria-keyshortcuts={row.shortcut === undefined ? undefined : `Meta+${row.shortcut}`}
            ref={index === selectedIndex ? (option) => option?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseMove={() => setSelectedName(row.name)}
            onClick={() => openRepository(row.name)}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              index === selectedIndex && "bg-accent text-accent-foreground",
            )}
          >
            <span className="truncate">{row.name}</span>
            {row.current && <span className="shrink-0 text-muted-foreground">(current)</span>}
            {hintShown && row.shortcut !== undefined && (
              <kbd className="ml-auto shrink-0 rounded border bg-muted px-1.5 font-sans text-xs text-muted-foreground">
                ⌘{row.shortcut}
              </kbd>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">No repositories found.</li>
        )}
      </ul>
    </>
  );
}
