import { useCallback, useEffect, useState } from 'react'
import { useWorkspace } from '@/auth/WorkspaceProvider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Avatar, ErrorBanner, PageHeader, Panel } from '@/components/shared'
import { api, ApiError, displayName, normalizePage, unwrap } from '@/lib/api'
import type { ApiEnvelope, Paginated, User, WorkspaceFeature } from '@/types/api'
import { SettingsNav } from './EntityPages'

interface DependentDataError {
  message?: string
  code?: string
  blockers?: Array<{ type: string; count: number; label: string }>
  dependent_features?: string[]
}

/**
 * Rename, feature toggles, and membership for the workspace the caller is
 * currently signed into. The zero-blocker toggle path is one request with no
 * confirmation — that is the common case, an empty or new workspace turning
 * something off before anyone has used it.
 */
export function WorkspaceSettingsPage() {
  const { settings, refresh: refreshWorkspace } = useWorkspace()
  const workspaceId = settings.active_workspace?.id ?? settings.activeWorkspace?.id
  const [name, setName] = useState('')
  const [nameBusy, setNameBusy] = useState(false)
  const [nameError, setNameError] = useState('')
  const [features, setFeatures] = useState<WorkspaceFeature[]>([])
  const [featuresLoading, setFeaturesLoading] = useState(true)
  const [featuresError, setFeaturesError] = useState('')
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [blockedKey, setBlockedKey] = useState<string | null>(null)
  const [blocker, setBlocker] = useState<DependentDataError | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [candidates, setCandidates] = useState<User[]>([])
  const [addUserId, setAddUserId] = useState('')
  const [membersBusy, setMembersBusy] = useState(false)
  const [membersError, setMembersError] = useState('')

  const loadFeatures = useCallback(async () => {
    if (!workspaceId) return
    setFeaturesLoading(true)
    setFeaturesError('')
    try {
      const response = unwrap(await api.get<ApiEnvelope<{ features: WorkspaceFeature[] }> | { features: WorkspaceFeature[] }>(`/api/workspaces/${workspaceId}/features`))
      setFeatures(response.features ?? [])
    } catch (reason) {
      setFeaturesError(reason instanceof Error ? reason.message : 'Unable to load feature switches.')
    } finally {
      setFeaturesLoading(false)
    }
  }, [workspaceId])

  const loadMembers = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [memberList, userPage] = await Promise.all([
        unwrap(await api.get<ApiEnvelope<User[]> | User[]>(`/api/workspaces/${workspaceId}/members`)),
        api.get<Paginated<User> | ApiEnvelope<Paginated<User>>>('/api/users', { per_page: 100 }).then(normalizePage).catch(() => ({ data: [] as User[] })),
      ])
      setMembers(Array.isArray(memberList) ? memberList : [])
      const memberIds = new Set((Array.isArray(memberList) ? memberList : []).map((member) => String(member.id)))
      setCandidates(userPage.data.filter((user) => !memberIds.has(String(user.id))))
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : 'Unable to load members.')
    }
  }, [workspaceId])

  useEffect(() => {
    setName(settings.active_workspace?.name ?? settings.activeWorkspace?.name ?? '')
  }, [settings.active_workspace, settings.activeWorkspace])

  useEffect(() => { void loadFeatures() }, [loadFeatures])
  useEffect(() => { void loadMembers() }, [loadMembers])

  const saveName = async () => {
    if (!workspaceId || !name.trim()) return
    setNameBusy(true)
    setNameError('')
    try {
      await api.patch(`/api/workspaces/${workspaceId}`, { name: name.trim() })
      await refreshWorkspace()
    } catch (reason) {
      setNameError(reason instanceof Error ? reason.message : 'The workspace could not be renamed.')
    } finally {
      setNameBusy(false)
    }
  }

  const toggle = async (feature: WorkspaceFeature, enabled: boolean, force = false) => {
    if (!workspaceId) return
    setPendingKey(feature.key)
    setFeaturesError('')
    if (!force) setBlockedKey(null)
    try {
      const response = unwrap(await api.patch<ApiEnvelope<{ features: WorkspaceFeature[] }> | { features: WorkspaceFeature[] }>(
        `/api/workspaces/${workspaceId}/features`,
        { features: { [feature.key]: enabled }, force },
      ))
      setFeatures(response.features ?? [])
      setBlockedKey(null)
      setBlocker(null)
      await refreshWorkspace()
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setBlockedKey(feature.key)
        setBlocker(reason.details as DependentDataError)
      } else {
        setFeaturesError(reason instanceof Error ? reason.message : 'That switch could not be changed.')
      }
    } finally {
      setPendingKey(null)
    }
  }

  const addMember = async () => {
    if (!workspaceId || !addUserId) return
    setMembersBusy(true)
    setMembersError('')
    try {
      await api.post(`/api/workspaces/${workspaceId}/members`, { user_id: addUserId })
      setAddUserId('')
      await loadMembers()
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : 'That person could not be added.')
    } finally {
      setMembersBusy(false)
    }
  }

  const removeMember = async (user: User) => {
    if (!workspaceId) return
    setMembersBusy(true)
    setMembersError('')
    try {
      await api.delete(`/api/workspaces/${workspaceId}/members/${user.id}`)
      await loadMembers()
    } catch (reason) {
      setMembersError(reason instanceof Error ? reason.message : 'That person could not be removed.')
    } finally {
      setMembersBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Settings" title="Workspace" description="Rename this workspace, choose what it uses, and manage who belongs to it." />
      <SettingsNav />

      <Panel title="Name">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48 space-y-2">
            <Label htmlFor="workspace-settings-name">Workspace name</Label>
            <Input id="workspace-settings-name" value={name} onChange={(event) => setName(event.target.value)} disabled={nameBusy} />
          </div>
          <Button onClick={saveName} disabled={nameBusy || !name.trim()}>{nameBusy ? 'Saving…' : 'Save'}</Button>
        </div>
        {nameError && <p className="mt-2 text-sm text-destructive" role="alert">{nameError}</p>}
      </Panel>

      <Panel title="Features" contentClassName="space-y-4">
        {featuresError && <ErrorBanner message={featuresError} onRetry={loadFeatures} />}
        {featuresLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <div className="divide-y">
            {features.map((feature) => (
              <div key={feature.key} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{feature.label}</p>
                    <p className="text-xs text-muted-foreground">{feature.description}</p>
                  </div>
                  <Switch
                    checked={feature.enabled}
                    disabled={pendingKey === feature.key}
                    onCheckedChange={(checked) => void toggle(feature, checked)}
                  />
                </div>
                {blockedKey === feature.key && blocker && (
                  <div className="rounded-lg border border-line bg-muted/40 p-3 text-sm">
                    <p>{blocker.message ?? 'This still has data behind it.'}</p>
                    {blocker.blockers?.length ? (
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {blocker.blockers.map((item) => (
                          <li key={item.type}>{item.label}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setBlockedKey(null)}>Review</Button>
                      {/* Not styled destructive: this hides the feature, it does not delete anything. */}
                      <Button size="sm" onClick={() => void toggle(feature, false, true)}>Disable anyway</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Members" contentClassName="space-y-4">
        {membersError && <ErrorBanner message={membersError} onRetry={loadMembers} />}
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-48 space-y-2">
            <Label htmlFor="workspace-settings-add-member">Add a member</Label>
            <select
              id="workspace-settings-add-member"
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              value={addUserId}
              onChange={(event) => setAddUserId(event.target.value)}
              disabled={membersBusy}
            >
              <option value="">Choose someone…</option>
              {candidates.map((user) => (
                <option key={user.id} value={user.id}>{displayName(user)}</option>
              ))}
            </select>
          </div>
          <Button onClick={addMember} disabled={membersBusy || !addUserId}>Add</Button>
        </div>
        <ul className="divide-y">
          {members.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex items-center gap-2">
                <Avatar user={member} />
                <span className="text-sm">{displayName(member)}</span>
              </div>
              <Button size="sm" variant="outline" disabled={membersBusy} onClick={() => void removeMember(member)}>
                Remove
              </Button>
            </li>
          ))}
          {!members.length && <li className="py-2 text-sm text-muted-foreground">No members yet.</li>}
        </ul>
      </Panel>
    </div>
  )
}
