import { useCallback, useEffect, useRef, useState } from 'react'
import { api, unwrap } from './api'
import type { ApiEnvelope, EntityId, TaskFolder } from '../types/api'

export type TaskFolderCatalog = Record<string, TaskFolder[]>

export function folderSort(folder: TaskFolder) {
  return folder.sortOrder ?? folder.sort_order ?? 0
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
