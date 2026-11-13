import { describe, expect, it } from 'vitest'
import { parseTheme, themeCookie } from './theme.ts'

describe('the theme a browser chose, from its cookie', () => {
  it('is auto when the browser never chose', () => {
    expect(parseTheme(undefined)).toBe('auto')
  })

  it('is the theme the browser chose', () => {
    expect(parseTheme('light')).toBe('light')
    expect(parseTheme('dark')).toBe('dark')
    expect(parseTheme('auto')).toBe('auto')
  })

  it('is auto for a value that names no theme, so it never reaches the page', () => {
    expect(parseTheme('')).toBe('auto')
    expect(parseTheme('Dark')).toBe('auto')
    expect(parseTheme('dark" onload="alert(1)')).toBe('auto')
  })
})

describe("the cookie that keeps a browser's theme", () => {
  it('holds the theme for every page for 400 days, the longest a browser keeps a cookie', () => {
    expect(themeCookie('dark')).toBe('stunt-theme=dark; path=/; max-age=34560000; samesite=lax')
    expect(themeCookie('auto')).toBe('stunt-theme=auto; path=/; max-age=34560000; samesite=lax')
  })
})
