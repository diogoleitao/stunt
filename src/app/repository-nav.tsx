"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { repositoryHref } from "./repository-href.ts";

// The sidebar's repository list, marking the one on screen.
export function RepositoryNav({ names }: { names: string[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Repositories" className="flex flex-col gap-0.5 p-2">
      {names.map((name) => {
        const href = repositoryHref(name);
        const current = pathname === href;
        return (
          <Link
            key={name}
            href={href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "truncate rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
            )}
          >
            {name}
          </Link>
        );
      })}
    </nav>
  );
}
