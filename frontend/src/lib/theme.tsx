import { createContext, use, type ReactNode } from 'react'

/**
 * The product has one theme. It is kept behind this module rather than
 * hard-coded at the call sites so the surfaces that still need to know
 * (the toaster, the legacy stylesheets) have one signal to read, and so
 * reintroducing a second theme is a change here and nowhere else.
 */
export type Theme = 'dark'

export const THEME: Theme = 'dark'

export function applyTheme(theme: Theme = THEME) {
  const root = document.documentElement
  root.classList.add('dark')
  // Mirrored onto the attribute so plain CSS and the legacy screens can branch
  // on the same signal Tailwind's `dark` variant uses.
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

interface ThemeContextValue {
  theme: Theme
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext value={{ theme: THEME }}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const context = use(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
