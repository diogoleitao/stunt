'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Tabs } from 'radix-ui'
import { type ReactNode, useEffect, useRef } from 'react'
import type { RepositoryModel } from '../stunt/page-model.ts'
import type { RepositoryTab } from './repository-href.ts'
import { repositoryTabs } from './repository-tabs.ts'

// A repository page's tabs, each labelled with its count, showing the panel of
// the tab the URL selects. Switching tabs replaces the URL with the tab's link
// in place, so the tab shows at once and Back leaves the page rather than the
// tab. Both panels stay mounted, so rows opened in one are still open on coming
// back to it.
export function RepositoryPageTabs ({
  name,
  counts,
  panels,
}: {
  name: string;
  counts: RepositoryModel['counts'];
  panels: Record<RepositoryTab, ReactNode>;
}) {
  const router = useRouter()
  const tabs = repositoryTabs({ name, counts, searchParams: useSearchParams() })
  const selected = tabs.find((row) => row.selected)?.tab
  const switched = useRef(false)

  // Next.js turns the replaced URL into a router restore, which discards a live
  // update's refresh still in flight, so refresh again once the switch is on
  // screen. Refreshing in the same event as the switch would hold the new tab
  // back until the refresh returns.
  useEffect(() => {
    if (!switched.current) return
    switched.current = false
    router.refresh()
  }, [selected, router])

  function selectTab (tab: string) {
    const row = tabs.find((candidate) => candidate.tab === tab)
    if (row === undefined) return
    switched.current = true
    window.history.replaceState(null, '', row.href)
  }

  return (
    <Tabs.Root
      value={selected}
      onValueChange={selectTab}
      className='flex flex-col gap-4'
    >
      <Tabs.List className='flex gap-4 border-b'>
        {tabs.map((row) => (
          <Tabs.Trigger
            key={row.tab}
            value={row.tab}
            className='-mb-px flex items-center gap-1 rounded-t-md border-b-2 border-transparent px-1 pb-2 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=active]:border-foreground data-[state=active]:text-foreground'
          >
            {row.label}
            <span className='font-normal text-muted-foreground tabular-nums'>({row.count})</span>
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {tabs.map((row) => (
        <Tabs.Content
          key={row.tab}
          value={row.tab}
          forceMount
          className='outline-none data-[state=inactive]:hidden'
        >
          {panels[row.tab]}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  )
}
