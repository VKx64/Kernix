import { NavLink } from 'react-router'
import { cn } from '@/lib/utils'
import type { EntityId } from '@/types/api'

const TABS = [
  { key: 'overview', label: 'Overview', to: '' },
  { key: 'tasks', label: 'Tasks', to: '/tasks' },
  { key: 'team', label: 'Team', to: '/team' },
  { key: 'activity', label: 'Activity', to: '/activity' },
  { key: 'forms', label: 'Forms', to: '/forms' },
] as const

/**
 * The project's own navigation: Overview / Tasks / Team / Activity / Forms,
 * each a sibling route under `/projects/:id`, the same way `/memory` already
 * sits beside the detail page. Forms carries a count badge, but only once a
 * form exists — an empty badge would just be noise on every project.
 */
export function ProjectTabStrip({ projectId, formsCount }: { projectId: EntityId; formsCount?: number }) {
  return (
    <nav aria-label="Project sections" className="flex items-center gap-[22px] overflow-x-auto border-b border-line">
      {TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={`/projects/${projectId}${tab.to}`}
          end={tab.to === ''}
          className={({ isActive }) => cn(
            'flex h-[43px] items-center gap-[7px] whitespace-nowrap border-b-[1.5px] border-transparent text-body-sm text-t3 transition-colors hover:text-t2',
            isActive && 'border-t1 font-semibold text-t1',
          )}
        >
          {tab.label}
          {tab.key === 'forms' && !!formsCount && (
            <span className="inline-flex h-[17px] items-center rounded-[5px] bg-[#1c1d2e] px-1.5 font-mono text-[10px] text-brand-hover">
              {formsCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
