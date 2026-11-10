// The color scheme a browser chose. Auto follows the OS.
export const THEMES = ['light', 'dark', 'auto'] as const
export type Theme = (typeof THEMES)[number]

// The cookie that keeps a browser's choice, so the server renders the page in
// it.
export const THEME_COOKIE = 'stunt-theme'

// The channel that tells a browser's other tabs of its choice.
export const THEME_CHANNEL = 'stunt-theme'

// A value that names no theme, such as a cookie edited by hand, reads as auto,
// so only a known theme ever reaches the page.
export function parseTheme (value: unknown): Theme {
  return THEMES.find((theme) => theme === value) ?? 'auto'
}

// The class on <html> that applies a theme. Auto has none, so the page
// follows the OS.
export function themeClass (theme: Theme): string | undefined {
  return theme === 'auto' ? undefined : theme
}

// 400 days, the longest a browser keeps a cookie.
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60

// The cookie that keeps `theme` for every page. Written again on every load,
// it lapses only after 400 days without stunt.
export function themeCookie (theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`
}
