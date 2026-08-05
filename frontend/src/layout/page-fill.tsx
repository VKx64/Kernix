import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Most pages are documents: they grow as tall as their content and the content
 * area scrolls. A few are workspaces instead — the task list is one — where the
 * page should occupy exactly the viewport and scroll something inside itself,
 * so a table can keep its column header and its pagination in view.
 *
 * A page asks for that by calling `usePageFill()`. The shell stops scrolling
 * and hands the page the full remaining height.
 */
const PageFillContext = createContext<((fill: boolean) => void) | null>(null)

export function PageFillProvider({
  children,
}: {
  children: (fill: boolean) => ReactNode
}) {
  const [fill, setFill] = useState(false)

  return (
    <PageFillContext value={setFill}>
      {children(fill)}
    </PageFillContext>
  )
}

/** Claims the full content height for as long as the calling page is mounted. */
export function usePageFill() {
  const setFill = useContext(PageFillContext)

  useEffect(() => {
    if (!setFill) return
    setFill(true)
    return () => setFill(false)
  }, [setFill])
}
