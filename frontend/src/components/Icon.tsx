import type { SVGProps } from 'react'

export type IconName =
  | 'analytics'
  | 'arrow-left'
  | 'briefcase'
  | 'building'
  | 'calendar'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'close'
  | 'contact'
  | 'dashboard'
  | 'edit'
  | 'field'
  | 'flag'
  | 'folder'
  | 'gear'
  | 'inbox'
  | 'logout'
  | 'menu'
  | 'more-horizontal'
  | 'moon'
  | 'pause'
  | 'play'
  | 'plus'
  | 'profile'
  | 'role'
  | 'search'
  | 'send'
  | 'sparkles'
  | 'sun'
  | 'task'
  | 'trash'
  | 'user'
  | 'users'

const paths: Record<IconName, React.ReactNode> = {
  analytics: <><path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/></>,
  'arrow-left': <><path d="m15 18-6-6 6-6"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/></>,
  building: <><path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5"/><path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  'chevron-down': <path d="m6 9 6 6 6-6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
  contact: <><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M18 8h4M20 6v4"/></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  field: <><path d="M4 6h16M4 12h10M4 18h16"/><circle cx="17" cy="12" r="2"/></>,
  flag: <><path d="M5 21V4"/><path d="M5 5h11l-2 4 2 4H5"/></>,
  folder: <path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2h-4v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1-2.8-2.8.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3v-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2.8-2.8.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1L19.7 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1h.2v4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></>,
  inbox: <><path d="M4 5h16v13H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/></>,
  menu: <><path d="M4 6h16M4 12h16M4 18h16"/></>,
  'more-horizontal': <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  play: <path d="m8 5 11 7-11 7Z"/>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  profile: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  role: <><path d="M12 3 4 6v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6Z"/><path d="m9 12 2 2 4-5"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
  sparkles: <><path d="m12 3 1.4 4.1L17.5 9l-4.1 1.6L12 15l-1.6-4.4L6.5 9l3.9-1.9Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  task: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 9 2 2 4-4M8 16h8"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></>,
  users: <><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M18 15a6 6 0 0 1 4 6"/></>,
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
