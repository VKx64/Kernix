import { useState } from 'react'
import { toast } from 'sonner'
import { Chip, Tag } from '@/components/kernix/chip'
import { LabelRow } from '@/components/kernix/label-row'
import { MetricTile } from '@/components/kernix/metric-tile'
import { Monogram, type MonogramSize } from '@/components/kernix/monogram'
import { healthRail, urgencyRail } from '@/components/kernix/rail'
import { Segmented } from '@/components/kernix/segmented'
import { EmptyState } from '@/components/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Toaster } from '@/components/ui/sonner'

/**
 * The primitive gallery. It renders every base component beside its states so
 * the token set and the type scale can be checked against the design without
 * a running API, and so later phases have somewhere to prove a new primitive
 * before it is wired to data.
 *
 * Development only — `App` does not register the route in a production build.
 */

const SURFACES = [
  ['bg', '#0b0b0c', 'App background'],
  ['inset', '#101013', 'Sunken wells'],
  ['surface', '#0f0f12', 'Cards, raised rows'],
  ['elev-low', '#141417', 'Segmented track'],
  ['elev', '#151518', 'Popovers, menus'],
  ['soft', '#17171a', 'Subtle fills, chips'],
  ['line-soft', '#1a1a1e', 'Card hairlines'],
  ['fill', '#1c1c21', 'Selected, neutral tiles'],
  ['line', '#1f1f23', 'Borders'],
  ['line-strong', '#232329', 'Selected segment'],
] as const

const TEXT = [
  ['t1', 'Primary text'],
  ['t2', 'Secondary text'],
  ['t3', 'Tertiary'],
  ['label-fg', 'Label rows'],
  ['t4', 'Muted, hints'],
  ['t5', 'Faintest'],
  ['t6', 'Axis ticks'],
] as const

const SIGNAL = [
  ['brand', '#7b7ff6', 'Brand, AI, links'],
  ['danger', '#f2585b', 'Overdue, critical'],
  ['warn', '#e8a33d', 'At risk, blocked, breaks'],
  ['good', '#4cb963', 'Done, tracking, healthy'],
] as const

const URGENCIES = [
  ['Critical', '#f2585b'],
  ['High', '#e8a33d'],
  ['Normal', '#7a7a85'],
  ['Low', null],
] as const

const MONOGRAM_SIZES: MonogramSize[] = ['xs', 'sm', 'md', 'lg', 'xl']

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <LabelRow>{title}</LabelRow>
      {children}
    </section>
  )
}

export function DesignSystemPage() {
  const [range, setRange] = useState<'today' | 'week'>('today')
  const [density, setDensity] = useState<'compact' | 'default'>('default')
  const [switched, setSwitched] = useState(true)

  return (
    <div className="flex min-h-svh flex-col gap-9 bg-bg px-7 py-6">
      <header className="space-y-1.5">
        <LabelRow>Phase 0 · foundation</LabelRow>
        <h1 className="text-h1">Primitives</h1>
        <p className="max-w-reading text-body text-t3">
          Every base component beside its states. The token set below is the only source of colour in
          the app — nothing in the component layer names a hex of its own.
        </p>
      </header>

      <Section title="Surfaces">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {SURFACES.map(([name, hex, use]) => (
            <div key={name} className="overflow-hidden rounded-lg border border-line">
              <div className="h-12" style={{ background: `var(--${name})` }} />
              <div className="space-y-0.5 px-2.5 py-2">
                <p className="font-mono text-meta-sm text-t2">{name}</p>
                <p className="font-mono text-[10.5px] text-t5">{hex}</p>
                <p className="text-meta-sm text-t4">{use}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Text ramp">
        <div className="flex flex-col gap-1">
          {TEXT.map(([name, use]) => (
            <p key={name} className="text-body-lg" style={{ color: `var(--${name})` }}>
              <span className="mr-3 inline-block w-20 font-mono text-meta-sm">{name}</span>
              {use} — the quick brown fox jumps over the lazy dog
            </p>
          ))}
        </div>
      </Section>

      <Section title="Signal">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SIGNAL.map(([name, hex, use]) => (
            <div key={name} className="flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5">
              <span className="size-7 flex-none rounded-md" style={{ background: `var(--${name})` }} />
              <div className="min-w-0">
                <p className="font-mono text-meta-sm text-t2">
                  {name} <span className="text-t5">{hex}</span>
                </p>
                <p className="text-meta-sm text-t4">{use}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type scale">
        <div className="flex flex-col gap-2.5">
          <p className="text-h1">h1 · 21px / 600 / -0.026em</p>
          <p className="text-title">Card title · 13.5px / 600</p>
          <p className="text-body-lg">Body large · 13.5px / 1.62 — the paragraph size for prose.</p>
          <p className="text-body">Body · 13px / 1.54 — the default the page inherits.</p>
          <p className="text-body-sm text-t2">Body small · 12.5px — button and control labels.</p>
          <p className="text-meta text-t3">Meta · 12px — row metadata.</p>
          <p className="text-meta-sm text-t4">Meta small · 11.5px — notes under a metric.</p>
          <LabelRow>Label · 10.5px / 600 / 0.1em uppercase</LabelRow>
          <p className="font-mono text-body">Mono · 13px tabular — 01:24:36 · KRN-104 · 4h 20m</p>
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button>New task</Button>
          <Button variant="outline">Filter</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Delete account</Button>
          <Button variant="link">A link</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" variant="outline">xs</Button>
          <Button size="sm" variant="outline">sm</Button>
          <Button variant="outline">default</Button>
          <Button size="lg" variant="outline">lg</Button>
        </div>
      </Section>

      <Section title="Chips and tags">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>What is at risk?</Chip>
          <Chip>Where am I over?</Chip>
          <Chip variant="active">Triage</Chip>
          <Chip variant="ghost">Clear</Chip>
          <Chip size="sm">Small</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag color="#4cb963">Acted</Tag>
          <Tag color="#f2585b">Risk</Tag>
          <Tag color="#e8a33d">Needs you</Tag>
          <Tag color="#7b7ff6">Standup</Tag>
          <Tag>Neutral</Tag>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="brand">In progress</Badge>
          <Badge variant="success">Done</Badge>
          <Badge variant="warning">In review</Badge>
          <Badge variant="destructive">Blocked</Badge>
        </div>
      </Section>

      <Section title="Segmented and switch">
        <div className="flex flex-wrap items-center gap-5">
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'This week' },
            ]}
          />
          <Segmented
            label="Row density"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact', label: 'Compact' },
              { value: 'default', label: 'Comfortable' },
            ]}
          />
          <div className="flex items-center gap-2.5">
            <Switch checked={switched} onCheckedChange={setSwitched} id="autopilot" />
            <label htmlFor="autopilot" className="text-body-sm text-t2">
              Autopilot {switched ? 'on' : 'off'}
            </label>
          </div>
        </div>
      </Section>

      <Section title="Monograms">
        <div className="flex flex-wrap items-end gap-4">
          {MONOGRAM_SIZES.map((size) => (
            <div key={size} className="flex flex-col items-center gap-1.5">
              <Monogram name="Northwind Health" color="#7b7ff6" size={size} />
              <span className="font-mono text-[10.5px] text-t5">{size}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1.5">
            <Monogram name="Kestrel Labs" size="lg" />
            <span className="font-mono text-[10.5px] text-t5">neutral</span>
          </div>
        </div>
      </Section>

      <Section title="Urgency rail">
        <div className="flex max-w-reading flex-col gap-1">
          {URGENCIES.map(([label, color]) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5"
              style={urgencyRail(color)}
            >
              <span className="size-1.5 flex-none rounded-full bg-brand" />
              <span className="flex-1 truncate text-body-lg">
                Remove the shared fallback password from portal login
              </span>
              <span className="text-meta text-t3">{label}</span>
              <span className="font-mono text-meta text-t4">KRN-104</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Cards, health rail, metrics">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricTile label="Due today" value="4" note="2 in progress" />
          <MetricTile label="Overdue" value="3" note="3d late · critical" danger />
          <MetricTile label="Tracked today" value="5h 20m" note="target 7h" />
          <MetricTile label="Retainer burn" value="104%" note="83h of 80h" danger />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card style={healthRail('#4cb963')}>
            <CardHeader>
              <CardTitle>Atlas Migration</CardTitle>
              <CardDescription>Northwind Health · due 28 August</CardDescription>
            </CardHeader>
            <CardContent className="text-body text-t2">
              Nine open tasks, four of them critical. Healthy against the retainer.
            </CardContent>
          </Card>
          <Card style={healthRail('#f2585b')}>
            <CardHeader>
              <CardTitle>Support Ops</CardTitle>
              <CardDescription>Internal · on hold</CardDescription>
            </CardHeader>
            <CardContent className="text-body text-t2">
              One task blocked on headcount approval for five days.
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Input, popover, toast">
        <div className="flex flex-wrap items-center gap-2">
          <Input className="w-64" placeholder="Search task title or project…" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline">Open a menu</Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 space-y-2">
              <LabelRow>Status</LabelRow>
              <div className="flex flex-col gap-0.5">
                {[
                  ['Not started', '#7a7a85'],
                  ['In progress', '#7b7ff6'],
                  ['Blocked', '#f2585b'],
                  ['In review', '#e8a33d'],
                  ['Done', '#4cb963'],
                ].map(([label, color]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex h-7 items-center gap-2.5 rounded-md px-2 text-body text-t2 hover:bg-soft hover:text-t1"
                  >
                    <span className="size-1.5 rounded-full" style={{ background: color }} />
                    {label}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            onClick={() =>
              toast('Moved 3 tasks to In review', {
                action: { label: 'Undo', onClick: () => undefined },
              })
            }
          >
            Fire a toast
          </Button>
        </div>
      </Section>

      <Section title="Empty state">
        <div className="max-w-reading">
          <EmptyState
            title="Nothing needs triage"
            description="No task is blocked, overdue, or urgent and unowned. This is the good outcome."
            action={<Button variant="outline">Show all tasks</Button>}
          />
        </div>
      </Section>

      <Toaster />
    </div>
  )
}
