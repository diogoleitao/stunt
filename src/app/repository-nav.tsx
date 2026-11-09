"use client";

import { GitPullRequest, Inbox } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { OwnerRow, RepositoryModel } from "../stunt/page-model.ts";
import { PulsingCount } from "./pulsing-count.tsx";
import { repositoryHref } from "./repository-href.ts";

const DASHBOARD_HREF = "/";

type Counts = RepositoryModel["counts"];

// The sidebar's links: the dashboard with the totals of every repository,
// then each owner's repositories under the owner, each with its Assigned PR
// and Review inbox counts, marking the one on screen.
export function RepositoryNav({ owners }: { owners: OwnerRow[] }) {
  const pathname = usePathname();
  const totals = owners
    .flatMap((row) => row.repositories)
    .reduce<Counts>(
      (total, { counts }) => ({
        assignedPRs: total.assignedPRs + counts.assignedPRs,
        reviewInbox: total.reviewInbox + counts.reviewInbox,
      }),
      { assignedPRs: 0, reviewInbox: 0 },
    );
  return (
    <nav aria-label="Repositories" className="flex flex-col gap-4 p-2">
      <NavLink href={DASHBOARD_HREF} current={pathname === DASHBOARD_HREF} label="Dashboard">
        <CountPair counts={totals} />
      </NavLink>
      {owners.map((row) => (
        <section key={row.owner} className="flex flex-col gap-0.5">
          <div className="truncate px-2 pb-1 text-xs text-muted-foreground">{row.owner}</div>
          {row.repositories.map(({ name, counts }) => {
            const href = repositoryHref(name);
            return (
              <NavLink
                key={name}
                href={href}
                current={pathname === href}
                label={name.slice(row.owner.length + 1)}
                owner={row.owner}
                indented
              >
                <CountPair counts={counts} />
              </NavLink>
            );
          })}
        </section>
      ))}
    </nav>
  );
}

function CountPair({ counts }: { counts: Counts }) {
  return (
    <>
      <Count title="Assigned PRs" icon={<GitPullRequest />} value={counts.assignedPRs} />
      <Count title="Review inbox" icon={<Inbox />} value={counts.reviewInbox} />
    </>
  );
}

function NavLink({
  href,
  current,
  label,
  owner,
  indented = false,
  children,
}: {
  href: string;
  current: boolean;
  label: string;
  // Read out before `label`, and shown with it on hover, so two owners'
  // same-named repositories stay apart.
  owner?: string;
  indented?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      title={owner === undefined ? undefined : `${owner}/${label}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        indented && "pl-4",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <span className="truncate">
        {owner !== undefined && <span className="sr-only">{owner}/</span>}
        {label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground tabular-nums">
        {children}
      </span>
    </Link>
  );
}

// Dimmed at zero, the icon at once and the number once its pulse ends.
function Count({ title, icon, value }: { title: string; icon: ReactNode; value: number }) {
  return (
    <span title={title} className={cn("flex items-center gap-0.5 [&_svg]:size-3", value === 0 && "[&>svg]:opacity-50")}>
      {icon}
      <PulsingCount value={value} className={cn(value === 0 && "opacity-50")} />
      <span className="sr-only">{title}</span>
    </span>
  );
}
