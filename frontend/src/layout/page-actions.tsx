import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * The app header owns a slot that pages render their primary actions into, so a
 * page never grows a second row of chrome directly under the one in the shell.
 *
 * `undefined` means no shell is above us at all — a page rendered on its own, as
 * tests do. `null` means the shell is there but has not handed the element over
 * yet, which lasts a single commit.
 */
export const PageActionsSlotContext = createContext<HTMLElement | null | undefined>(undefined)

/**
 * Renders its children into the app header, falling back to rendering them in
 * place when there is no shell. The fallback matters: without it a page mounted
 * outside the shell would quietly lose its primary actions.
 */
export function PageActions({ children }: { children: ReactNode }) {
  const slot = useContext(PageActionsSlotContext)
  if (slot === undefined) return <>{children}</>
  if (slot === null) return null
  return createPortal(children, slot)
}
