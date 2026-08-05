import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'theme'

/** Dark is the product default: an unset preference opens dark, not the OS setting. */
export function readStoredTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark'
  return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  // Mirrored onto the attribute so plain CSS and the legacy screens can branch
  // on the same signal Tailwind's `dark` variant uses.
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(() => setThemeState((current) => (current === 'dark' ? 'light' : 'dark')), [])

  return <ThemeContext value={{ theme, setTheme, toggleTheme }}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
