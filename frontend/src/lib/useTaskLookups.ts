import { useEffect, useMemo, useState } from 'react'
import { api, normalizePage, unwrap } from './api'
import { useCan } from './permissions'
import type { ApiEnvelope, CustomField, FieldValue, Paginated, Project, UserSummary } from '../types/api'

/**
 * The catalogue every task surface needs: projects to file work under, people to
 * assign it to, and the workspace's own status, type and urgency vocabularies.
 *
 * `/api/bootstrap` already carries all of it, so this is one request. Projects
 * fall back to their own endpoint because bootstrap only includes them for a
 * role that can see projects at all.
 */
export interface TaskLookups {
  projects: Project[]
  users: UserSummary[]
  fields: CustomField[]
  statusOptions: FieldValue[]
  typeOptions: FieldValue[]
  urgencyOptions: FieldValue[]
  loading: boolean
}

interface BootstrapLookups {
  projects?: Project[]
  assignees?: UserSummary[]
  coworkers?: UserSummary[]
  fields?: CustomField[]
}

export function fieldValues(fields: CustomField[], key: string): FieldValue[] {
  const match = fields.find((field) => (field.key ?? (field as CustomField & { key_name?: string }).key_name) === key)
  return match?.values ?? []
}

export function useTaskLookups(enabled = true): TaskLookups {
  const can = useCan()
  const [state, setState] = useState<{ projects: Project[]; users: UserSummary[]; fields: CustomField[]; loading: boolean }>({
    projects: [], users: [], fields: [], loading: enabled,
  })

  useEffect(() => {
    if (!enabled) return
    let active = true
    void Promise.allSettled([
      api.get<ApiEnvelope<BootstrapLookups> | BootstrapLookups>('/api/bootstrap'),
      can('projects.view')
        ? api.get<Paginated<Project> | ApiEnvelope<Paginated<Project>> | Project[]>('/api/projects', { per_page: 100 })
        : Promise.resolve(null),
    ]).then(([bootstrapResult, projectResult]) => {
      if (!active) return
      const bootstrap = bootstrapResult.status === 'fulfilled' ? unwrap(bootstrapResult.value) : {}
      setState({
        projects: bootstrap.projects?.length
          ? bootstrap.projects
          : projectResult.status === 'fulfilled' && projectResult.value
            ? normalizePage(projectResult.value).data
            : [],
        users: bootstrap.assignees ?? bootstrap.coworkers ?? [],
        fields: bootstrap.fields ?? [],
        loading: false,
      })
    })
    return () => { active = false }
  }, [can, enabled])

  // Memoised because callers put these arrays in dependency lists. Deriving
  // them inline would hand back a new array on every render and invalidate
  // every memo downstream.
  return useMemo(() => ({
    ...state,
    statusOptions: fieldValues(state.fields, 'task_status'),
    typeOptions: fieldValues(state.fields, 'task_type'),
    urgencyOptions: fieldValues(state.fields, 'task_urgency'),
  }), [state])
}
