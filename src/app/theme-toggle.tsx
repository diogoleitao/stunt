'use client'

import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { parseTheme, THEME_CHANNEL, THEMES, type Theme, themeClass, themeCookie } from './theme.ts'

const CHOICES: { theme: Theme; label: string; Icon: LucideIcon }[] = [
  { theme: 'light', label: 'Light', Icon: Sun },
  { theme: 'dark', label: 'Dark', Icon: Moon },
  { theme: 'auto', label: 'Auto', Icon: Monitor },
]

// Switches the page to the theme chosen, at once and in every other tab of
// this browser, and keeps it in a cookie, so the next page the server renders
// is already in it. Writing the cookie again on every load keeps it from
// lapsing while stunt is in use.
export function ThemeToggle ({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial)
  const otherTabs = useRef<BroadcastChannel>(null)

  useEffect(() => {
    const channel = new BroadcastChannel(THEME_CHANNEL)
    channel.onmessage = (event: MessageEvent) => setTheme(parseTheme(event.data))
    otherTabs.current = channel
    return () => channel.close()
  }, [])

  useEffect(() => {
    document.cookie = themeCookie(theme)
  }, [theme])

  // A server render asked for before the latest choice, such as a refresh
  // after a check, puts the theme its cookie held on <html>, and with it a new
  // `initial`, so the choice goes back on after every such render.
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove(...THEMES)
    const name = themeClass(theme)
    if (name !== undefined) root.classList.add(name)
  }, [theme, initial])

  function choose (next: Theme) {
    setTheme(next)
    otherTabs.current?.postMessage(next)
  }

  return (
    <div role='group' aria-label='Theme' className='inline-flex gap-0.5 rounded-md border border-sidebar-border p-0.5'>
      {CHOICES.map(({ theme: value, label, Icon }) => (
        <Button
          key={value}
          variant={theme === value ? 'default' : 'ghost'}
          size='icon'
          aria-label={label}
          title={label}
          aria-pressed={theme === value}
          onClick={() => choose(value)}
          className='size-7'
        >
          <Icon />
        </Button>
      ))}
    </div>
  )
}
