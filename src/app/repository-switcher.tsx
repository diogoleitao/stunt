"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { repositoryHref } from "./repository-href.ts";

// The Cmd+K switcher over the sidebar's repositories. Escape closes it.
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

// Filters the repositories by owner/repo as you type, moves the selection with
// the arrow keys, and opens the selected repository's page on Enter. Mounted
// only while the switcher is open, so every opening starts from an empty query.
function RepositoryPicker({ names, onPick }: { names: string[]; onPick: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  // Held by name so a live refresh that reorders the repositories keeps the
  // same one selected; the first match is selected when it is gone or unset.
  const [selectedName, setSelectedName] = useState<string>();

  const matches = names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
  const selectedIndex = Math.max(0, matches.indexOf(selectedName ?? ""));

  function openRepository(name: string) {
    onPick();
    router.push(repositoryHref(name));
  }

  function navigateMatches(event: KeyboardEvent<HTMLInputElement>) {
    if (matches.length === 0 || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedName(matches[(selectedIndex + 1) % matches.length]);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedName(matches[(selectedIndex - 1 + matches.length) % matches.length]);
    } else if (event.key === "Enter") {
      event.preventDefault();
      openRepository(matches[selectedIndex]);
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
          aria-activedescendant={matches.length > 0 ? optionId(selectedIndex) : undefined}
          aria-label="Repository"
          placeholder="owner/repo"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedName(undefined);
          }}
          onKeyDown={navigateMatches}
          className="h-11 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Repositories" className="max-h-80 overflow-y-auto p-1">
        {matches.map((name, index) => (
          <li
            key={name}
            id={optionId(index)}
            role="option"
            aria-selected={index === selectedIndex}
            ref={index === selectedIndex ? (option) => option?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseMove={() => setSelectedName(name)}
            onClick={() => openRepository(name)}
            className={cn(
              "cursor-pointer truncate rounded-md px-2 py-1.5 text-sm",
              index === selectedIndex && "bg-accent text-accent-foreground",
            )}
          >
            {name}
          </li>
        ))}
        {matches.length === 0 && (
          <li className="px-2 py-6 text-center text-sm text-muted-foreground">No repositories found.</li>
        )}
      </ul>
    </>
  );
}
