import type { ClockState, TimeState } from './types'
import { BRAND_NAME } from './brand'

export function badgeForState(state?: ClockState | 'stale' | null) {
  switch (state) {
    case 'working': return { text: 'ON', color: '#2dbd8c', title: `${BRAND_NAME} · Working` }
    case 'break': return { text: 'BRK', color: '#d6a632', title: `${BRAND_NAME} · On break` }
    case 'stale': return { text: '?', color: '#756d81', title: `${BRAND_NAME} · Connection needs attention` }
    default: return { text: '', color: '#756d81', title: `${BRAND_NAME} · Clocked out` }
  }
}

export function elapsedSeconds(time: TimeState | null, nowMs = Date.now()): number {
  if (!time?.session?.clock_in_at) return 0
  const started = new Date(time.session.clock_in_at).getTime()
  const ended = time.session.clock_out_at ? new Date(time.session.clock_out_at).getTime() : nowMs
  const breakMs = (time.session.breaks ?? []).reduce((total, item) => {
    const breakStart = new Date(item.start_at).getTime()
    const breakEnd = item.end_at ? new Date(item.end_at).getTime() : nowMs
    return total + Math.max(0, breakEnd - breakStart)
  }, 0)
  return Math.max(0, Math.floor((ended - started - breakMs) / 1000))
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}
