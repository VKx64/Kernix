import { useCallback } from 'react'
import { useWorkspace } from '@/auth/WorkspaceProvider'

/**
 * Per-workspace feature switches, read from `WorkspaceProvider` rather than
 * `AuthProvider` — permissions are about who the signed-in person is,
 * features are about what this workspace has turned on. Keeping them in
 * separate files mirrors that split.
 *
 * A key absent from the payload reads as enabled: an older or erroring
 * server that omits `features` entirely must not blank the whole nav.
 */
export function hasFeature(features: Record<string, boolean> | undefined, key: string): boolean {
  return features?.[key] ?? true
}

export function useFeature() {
  const { features } = useWorkspace()
  return useCallback((key: string) => hasFeature(features, key), [features])
}
