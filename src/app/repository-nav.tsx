"use client";

import { GitPullRequest, Inbox, ListTodo } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { RepositoryModel } from "../stunt/page-model.ts";
import { repositoryHref } from "./repository-href.ts";

const ALL_TASKS_HREF = "/tasks";

// The sidebar's links: the All Tasks view, then each repository with its open
// Task, Assigned PR, and Review inbox counts, marking the one on screen.
export function RepositoryNav({ repositories }: { repositories: Pick<RepositoryModel, "name" | "counts">[] }) {
  const pathname = usePathname();
  const openTaskTotal = repositories.reduce((total, repository) => total + repository.counts.tasks, 0);
  return (
    <nav aria-label="Repositories" className="flex flex-col gap-0.5 p-2">
      <NavLink href={ALL_TASKS_HREF} current={pathname === ALL_TASKS_HREF} label="All Tasks">
        <Count title="Open Tasks" icon={<ListTodo />} value={openTaskTotal} />
      </NavLink>
      {repositories.map(({ name, counts }) => {
        const href = repositoryHref(name);
        return (
          <NavLink key={name} href={href} current={pathname === href} label={name}>
            <Count title="Open Tasks" icon={<ListTodo />} value={counts.tasks} />
            <Count title="Assigned PRs" icon={<GitPullRequest />} value={counts.assignedPRs} />
            <Count title="Review inbox" icon={<Inbox />} value={counts.reviewInbox} />
          </NavLink>
        );
      })}
    </nav>
  );
}

function NavLink({
  href,
  current,
  label,
  children,
}: {
  href: string;
  current: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs font-normal text-muted-foreground tabular-nums">
        {children}
      </span>
    </Link>
  );
}

function Count({ title, icon, value }: { title: string; icon: ReactNode; value: number }) {
  return (
    <span title={title} className={cn("flex items-center gap-0.5 [&_svg]:size-3", value === 0 && "opacity-50")}>
      {icon}
      {value}
      <span className="sr-only">{title}</span>
    </span>
  );
}
