import { useCallback, useEffect, useRef, useState } from 'react'
import { api, unwrap } from './api'
import type { ApiEnvelope, EntityId, TaskFolder } from '../types/api'

export type TaskFolderCatalog = Record<string, TaskFolder[]>

export function folderSort(folder: TaskFolder) {
  return folder.sortOrder ?? folder.sort_order ?? 0
}

export function folderParentId(folder: TaskFolder): string {
  const parent = folder.parentId ?? folder.parent_id ?? null
  return parent === null || parent === undefined ? '' : String(parent)
}

export type FolderNode = { folder: TaskFolder; depth: number; path: string }

/**
 * A flat list in tree order, each entry carrying how deep it sits.
 *
 * The API already returns parents before children, but a client that has
 * inserted a folder locally, or one reading a cached list, cannot rely on
 * that — so the order is rebuilt here rather than trusted. A folder whose
 * parent is missing or forms a cycle is appended at the top level instead of
 * being dropped, because a folder nobody can see is a folder nobody can fix.
 */
export function folderTree(folders: TaskFolder[]): FolderNode[] {
  const byParent = new Map<string, TaskFolder[]>()
  folders.forEach((folder) => {
    const key = folderParentId(folder)
    byParent.set(key, [...(byParent.get(key) ?? []), folder])
  })
  byParent.forEach((group) => group.sort((left, right) => folderSort(left) - folderSort(right) || left.name.localeCompare(right.name)))

  const nodes: FolderNode[] = []
  const seen = new Set<string>()
  const walk = (parentKey: string, depth: number, prefix: string) => {
    ;(byParent.get(parentKey) ?? []).forEach((folder) => {
      const id = String(folder.id)
      if (seen.has(id)) return
      seen.add(id)
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name
      nodes.push({ folder, depth, path })
      walk(id, depth + 1, path)
    })
  }
  walk('', 0, '')

  folders.forEach((folder) => {
    if (seen.has(String(folder.id))) return
    seen.add(String(folder.id))
    nodes.push({ folder, depth: 0, path: folder.name })
  })

  return nodes
}

/** Ids of everything below a folder, for guarding a move against its own subtree. */
export function folderDescendantIds(folders: TaskFolder[], folderId: EntityId): Set<string> {
  const byParent = new Map<string, TaskFolder[]>()
  folders.forEach((folder) => {
    const key = folderParentId(folder)
    byParent.set(key, [...(byParent.get(key) ?? []), folder])
  })
  const ids = new Set<string>()
  const queue = [String(folderId)]
  while (queue.length) {
    const current = queue.shift() as string
    ;(byParent.get(current) ?? []).forEach((child) => {
      const id = String(child.id)
      if (ids.has(id)) return
      ids.add(id)
      queue.push(id)
    })
  }
  return ids
}

/**
 * Task folders, per project, fetched lazily and cached.
 *
 * Folders live under a project, so a screen showing tasks from many projects
 * would otherwise need a request per project every time anything re-rendered.
 * Only projects not already fetched are requested, and a project whose fetch
 * failed keeps its own error rather than failing the whole catalogue — one
 * project the signed-in role cannot read must not blank the others.
 */
export function useTaskFolderCatalog(projectIds: EntityId[]) {
  const projectKey = [...new Set(projectIds.map(String).filter(Boolean))].sort().join(',')
  const [foldersByProject, setFoldersByProject] = useState<TaskFolderCatalog>({})
  const [errorsByProject, setErrorsByProject] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(Boolean(projectKey))
  const loadedProjects = useRef(new Set<string>())

  const load = useCallback(async (isCurrent: () => boolean = () => true, force = false) => {
    const ids = projectKey ? projectKey.split(',') : []
    if (force) loadedProjects.current.clear()
    if (!ids.length) {
      loadedProjects.current.clear()
      if (isCurrent()) {
        setFoldersByProject({})
        setErrorsByProject({})
        setLoading(false)
      }
      return
    }

    const pending = ids.filter((projectId) => !loadedProjects.current.has(projectId))
    if (!pending.length) {
      if (isCurrent()) setLoading(false)
      return
    }

    setLoading(true)
    const results = await Promise.allSettled(pending.map(async (projectId) => {
      const response = await api.get<ApiEnvelope<TaskFolder[]> | TaskFolder[]>(`/api/projects/${projectId}/task-folders`)
      const folders = unwrap(response)
      return (Array.isArray(folders) ? folders : [])
        .slice()
        .sort((left, right) => folderSort(left) - folderSort(right) || left.name.localeCompare(right.name))
    }))
    if (!isCurrent()) return

    const nextFolders: TaskFolderCatalog = {}
    const nextErrors: Record<string, string> = {}
    results.forEach((result, index) => {
      const projectId = pending[index]
      if (result.status === 'fulfilled') {
        nextFolders[projectId] = result.value
        loadedProjects.current.add(projectId)
      } else {
        nextErrors[projectId] = result.reason instanceof Error ? result.reason.message : 'Unable to load task folders.'
      }
    })
    setFoldersByProject((current) => ({ ...current, ...nextFolders }))
    setErrorsByProject((current) => {
      const merged = { ...current, ...nextErrors }
      pending.forEach((projectId) => { if (!nextErrors[projectId]) delete merged[projectId] })
      return merged
    })
    setLoading(false)
  }, [projectKey])

  useEffect(() => {
    let current = true
    void load(() => current)
    return () => { current = false }
  }, [load])

  return {
    foldersByProject,
    errorsByProject,
    loading,
    error: Object.values(errorsByProject)[0] ?? '',
    reload: () => load(() => true, true),
  }
}
