# Kernix UI Design Contract

Last aligned with the React/Vite interface on 2026-07-14.

This document is the implementation contract for new frontend features. It records the visual language, page patterns, interaction rules, responsive behavior, and product-specific constraints already present in the application. New work should feel native to the current interface, not like a separate mini-application.

## Source of truth

The current React frontend is authoritative:

- `frontend/src/styles.css` — themes, tokens, layout, responsive behavior, and component styling.
- `frontend/src/components/ui.tsx` — shared UI primitives and their behavior.
- `frontend/src/components/Icon.tsx` — the line-icon family.
- `frontend/src/layout/AppShell.tsx` — navigation, global search, time tracking, theme, and user controls.
- `frontend/src/pages/` — canonical page compositions.

The files under `legacy/assets/css/` belong to the preserved PHP fallback and are not the design source for new React features.

If an intentional redesign changes these rules, update the shared primitives or tokens first and update this document in the same change.

## Product character

The interface is a calm, compact operations workspace. It should communicate a lot without feeling noisy.

1. **Calm density.** Prefer compact controls, short copy, restrained borders, and predictable alignment over oversized presentation UI.
2. **Context before decoration.** Entity names, client/project context, status, ownership, dates, and time are more important than ornamental graphics.
3. **One obvious next action.** A page may have several controls, but only its main forward action should use the primary treatment.
4. **Progressive disclosure.** Lists lead to details; secondary editing happens in modals or tabs; infrequent controls live in popovers or settings sections.
5. **Honest state.** Every async surface must account for loading, empty, error, success, disabled, permission-limited, and archived/read-only states.
6. **Semantic color.** Color supports text; it never replaces a label, icon, or state description.

## Visual identity

### Themes and color tokens

Dark mode is the default. Light mode is a complete token override, while the sidebar deliberately remains dark. Never hard-code a new surface or text color when an existing semantic variable fits.

| Token | Dark/default | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0b0911` | `#f6f4f9` | Application canvas |
| `--bg-soft` | `#100d18` | `#eeebf3` | Subtle background layer |
| `--surface` | `#15111e` | `#ffffff` | Panels, cards, popovers |
| `--surface-2` | `#1c1727` | `#f8f6fb` | Inputs, toolbars, nested areas |
| `--surface-3` | `#272032` | `#ece8f2` | Stronger nested/disabled layer |
| `--surface-hover` | `#221b2f` | `#f2eef8` | Row hover |
| `--sidebar` | `#0e0b15` | `#17111f` | Sidebar in both themes |
| `--text` | `#f5f2fb` | `#241c2d` | Primary text |
| `--text-soft` | `#bbb3c8` | `#665d70` | Secondary readable text |
| `--muted` | `#847b91` | `#8b8294` | Metadata and low-emphasis copy |
| `--border` | `#2b2436` | `#e4deea` | Default dividers and borders |
| `--border-strong` | `#3b3149` | `#d5ccdf` | Modals and emphasized boundaries |
| `--primary` | `#9c6cff` | `#8054e8` | Primary action and selection |
| `--primary-strong` | `#8150ed` | `#6d3ed6` | Gradients and stronger emphasis |
| `--primary-soft` | `rgba(156,108,255,.14)` | `rgba(128,84,232,.10)` | Selected/soft primary background |
| `--primary-ring` | `rgba(156,108,255,.25)` | `rgba(128,84,232,.20)` | Focus ring |
| `--shadow` | `0 20px 55px rgba(0,0,0,.28)` | `0 16px 44px rgba(53,35,69,.10)` | Popovers and modals only |

Shared semantic colors:

- Success: `#43d9a3`
- Danger: `#fb7185`
- Warning: `#f9c74f`
- Informational blue: `#60a5fa`

Status-like data may supply its own color. Render it through `StatusBadge`, which blends that color into a soft background and border while retaining a text label and dot. Do not create one-off status classes.

Charts use the existing restrained palette: `#8b5cf6`, `#c084fc`, `#5eead4`, `#fbbf24`, `#60a5fa`, and `#fb7185`.

### Typography

- Body and controls: **DM Sans**, weights 400–700.
- Headings, strong values, and brand copy: **Manrope**, weights 600–800.
- System fallback: `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif.
- Body line-height: `1.5`.
- Page title: `clamp(1.65rem, 2.5vw, 2.2rem)`, line-height `1.1`, tracking `-.04em`.
- Detail title: `clamp(1.6rem, 3vw, 2.25rem)`, tracking `-.04em`.
- Eyebrow: `.65rem`, weight 800, uppercase, `.14em` tracking, primary color.
- Panel heading: about `.95rem`.
- Normal product text: `.70rem`–`.90rem`; metrics: `1.45rem`–`1.65rem`.
- Table headers: `.64rem`, weight 800, uppercase, `.07em` tracking.
- Use tabular numerals for durations, counts, money-like figures, and aligned metrics.

Copy should remain legible at the existing compact scale. Do not shrink body or control text below current conventions to make a layout fit.

### Spacing, shape, and elevation

There is no formal spacing-token API yet. Reuse the established compact values: `6, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20, 24px`.

| Element | Contract |
| --- | --- |
| Standard panel/card | `20px` padding, `14px` radius, 1px token border |
| Standard control | `40px` minimum height, `8–9px` radius |
| Standard button | `39px` minimum height, `8px 14px` padding, `9px` radius |
| Large button | `48px` minimum height |
| Icon button | `36px × 36px`, `9px` radius |
| Main grid gap | `13–14px` |
| Form grid gap | `14px`; label-to-control gap `6px` |
| Modal | `16px` radius; `20px` body padding |
| Pills, badges, progress | `99px` radius |

Use shadows only for floating layers such as popovers and modals. Normal panels are separated by surface, border, and spacing—not elevation.

Approved gradients are restrained:

- Primary action: lavender to `--primary-strong`.
- Brand mark: light lavender to deep violet.
- Time/summary areas: `--surface` to `--surface-2`.
- Progress: primary to success.

## Application shell

The protected application always uses the shared `AppShell`.

### Desktop shell

- Fixed left sidebar: `244px` wide, `24px 16px` padding.
- Sticky topbar: `68px` high, `28px` horizontal padding.
- Content begins after the sidebar, is capped at `1560px`, and uses `30px 34px 54px` padding.
- Sidebar order remains: Dashboard, Messages, Tasks, Projects, Clients, Contacts, Analytics, Administration.
- Administration links to the first permitted Settings, Users, Roles, or Fields tab and is active throughout `/settings/*`.
- The topbar contains mobile navigation, global task search, time tracking, theme toggle, and the user menu.

Navigation is permission-aware. Hide inaccessible destinations and actions; do not render controls that only fail after interaction. Hide Clients in single-client mode.

### Brand

The brand mark is a 38px rounded violet tile containing the application initial. The name and `Workspace` label sit beside it. Use configured app branding where available; do not hard-code a feature-specific logo.

### Global controls

- Global search submits to the task list and must preserve URL-safe query state.
- Theme preference is stored as `theme` in `localStorage` and applied through `data-theme` on `<html>`.
- When `time.track` is granted, the time control exposes clocked-out, working, and break states consistently in the topbar and sidebar. Without it, no timer control or time-status polling is rendered.
- User controls belong in the existing popover: Profile, Settings when permitted, and Sign out.

## Reusable component contract

Prefer the primitives in `frontend/src/components/ui.tsx` before writing bespoke markup.

| Primitive | Use |
| --- | --- |
| `PageHeader` | Eyebrow, page title, short description, and right-side page action |
| `Panel` | Standard bounded content surface with optional title/action |
| `Avatar` | Profile image or initials fallback |
| `StatusBadge` | Status, urgency, type, or another colored field value |
| `SearchToolbar` | Collection search plus chips/select filters |
| `DataTable` | Tabular collections with loading, empty, and optional clickable-row behavior |
| `Pagination` | Server-paginated collections |
| `Modal` | Create/edit and focused secondary workflows |
| `EntityForm` | Metadata-driven create/edit/settings/profile forms |
| `EmptyState` | Full collection empty state with short guidance |
| `ErrorBanner` | Page or mutation error; include retry when reload is meaningful |
| `LoadingRows` | Table skeletons |
| `Minutes` | Every displayed duration |

Icons come only from `Icon.tsx`: 24px view box, rounded line work, stroke width `1.8`, normally rendered at 15–20px. Extend the `IconName` union and path map when a new symbol is needed. Do not introduce another icon family for one feature.

## Button and action hierarchy

- **Primary** (`btn-primary`): one forward action—create, save, restore, sign in, or resume.
- **Quiet** (`btn-quiet`): cancel, retry, pause, and secondary actions.
- **Danger quiet** (`btn-danger-quiet`): archive, remove, clock out, or another risky action.
- **Icon button**: compact row and chrome actions only; always include `title` and `aria-label`.
- Prefer explicit verb+noun labels: `New project`, `Create task`, `Save changes`, `Restore task`.
- Busy actions disable themselves and change to a present-progress label such as `Saving…` or `Signing in…`.
- Hover movement is subtle: `-1px` for buttons, at most `-2px` for interactive metric cards.

Use Archive/Restore for business entities. Reserve Delete for genuinely irreversible administration data, and confirm archive, restore, and delete actions before the request.

## Canonical page patterns

### Collection/list page

Use this order:

1. `PageHeader` with eyebrow, plural entity title, one-sentence description, and optional `New …` action.
2. Page-level `ErrorBanner`.
3. `Panel` with `list-panel`.
4. `SearchToolbar` with search on the left and compact chips/selects on the right.
5. `DataTable`.
6. `Pagination`.
7. Create/edit `Modal` + `EntityForm` outside the panel.

Table conventions:

- The first column uses `primary-cell`: bold entity name and muted secondary context.
- Column labels are short nouns.
- Status-like values use `StatusBadge`.
- Dates use local display formatting; missing values render as an em dash.
- Durations use `Minutes`; numeric columns use tabular figures and right alignment.
- Row actions are right-aligned icon buttons.
- A row is clickable only when it has a meaningful drill-down destination. Support Enter and Space when it is clickable.
- Keep the `720px` minimum table width and horizontal scrolling on smaller screens.
- Reset pagination to page 1 whenever search or filters change.

Canonical references: Projects, Clients, Contacts, and Users.

### Detail/workspace page

Use this order:

1. Back link.
2. Breadcrumb/context, title, status metadata, and right-side actions.
3. Business-rule banner when applicable.
4. Compact summary strip or metrics.
5. Optional brief/content panels.
6. Tabbed workspace for independent work streams.
7. Edit modal.

Task detail is the reference. Preserve its richer header rather than forcing every detail page into `PageHeader`.

### Dashboard/report page

Use:

1. `PageHeader` with a compact date-range control.
2. Summary/metric grid.
3. Paired chart or breakdown panels.
4. A final activity list or records table.

Dashboard and Analytics are the references. Do not show an empty-state message while the same area is still loading.

### Master-detail page

Messages is the reference:

- Search/scope/list in the left pane.
- Selected item and its actions in the right pane.
- Clear placeholder when nothing is selected.
- Collapse into a vertical list/detail flow on mobile.

### Settings/profile page

- Use the shared Settings subnavigation for administration destinations.
- Use a narrow section/card column and a flexible form panel on desktop.
- Collapse to one column at mobile width.
- A user with view-only permission sees disabled controls plus an explicit read-only note.

### Authentication and standalone states

- Login uses a two-column story/form layout; below `820px`, hide the story and give the form the full viewport.
- Boot, 403, 404, and similar standalone states remain centered, concise, and action-oriented.

## Forms and modals

- Forms are two columns by default and one column at `640px` and below.
- Identity/title fields and descriptions/notes are normally full width.
- Order fields as: identity/title, relationships, status/type, dates/numbers, long description.
- Place required markers in the label and use native `required`, input types, min, and step where possible.
- Provide concise helper text only when the rule is not obvious.
- Inputs use `--surface-2`, token borders, and the primary 3px focus ring.
- Textareas resize vertically and begin around 100px high.
- Form errors appear immediately above the footer and use `role="alert"`.
- Footer actions are right aligned: Cancel, then the primary submit action.
- A modal closes through its Close action, Escape, or backdrop click when not busy.
- Do not close or discard a form while its save is in progress.

`EntityForm` initializes controlled state from its field list. For lookup-driven forms, keep the field list stable before mounting, even if `options` are initially empty. Do not conditionally add a field after async lookups arrive unless the form safely merges the new default without overwriting user edits.

## Search, filters, tabs, and URL state

- Debounce collection search by roughly 250ms and abort obsolete requests.
- Put shareable task/message search, filters, selected records, and sorting in URL query parameters.
- Local-only view toggles are acceptable when sharing/back-navigation is not valuable, but choose deliberately.
- Filter chips are compact pills. Selected chips use `--primary-soft`, primary border, and primary text.
- Tab rows use a 2px primary underline and muted inactive labels; allow horizontal scrolling rather than wrapping.
- New tabs must add proper tab semantics: `tablist`, `tab`, `tabpanel`, `aria-selected`, and keyboard navigation.

## Async and data states

Every new data surface must design these states before it is considered complete:

| State | Expected presentation |
| --- | --- |
| Initial page boot | Centered brand/spinner message when the whole app is unavailable |
| Table loading | `LoadingRows` skeleton matching column count |
| Panel/detail loading | Spinner plus a short present-progress label |
| Empty collection | Contextual title, one useful explanation, optional next action |
| Empty inline region | Muted centered sentence; no oversized empty card |
| Fetch error | `ErrorBanner`; add `Try again` when a reload action exists |
| Mutation error | Keep form/content in place and show an inline alert/banner |
| Success | Brief success banner for settings/profile or a refreshed authoritative view |
| Busy action | Disabled control with progressive label |
| Archived/read-only | Explicit state and no write controls |
| Permission-limited | Hide unavailable actions; show read-only explanation when viewing is allowed |

Empty-state language is calm and specific. Prefer “No tasks match this view” and “Try changing a filter…” over “Nothing found!” or blame-oriented copy.

## Product-specific UI rules

These are part of the interface contract, not optional backend details.

### Permissions

- Protect both the route and its visible navigation/actions.
- Do not expose unauthorized actions as apparently usable controls.
- Preserve the friendly 403 state for direct unauthorized navigation.
- Treat the Laravel permission catalog returned by `/api/roles/permissions` as the only assignable-permission source; never duplicate permission keys in React.
- Every custom role includes `dashboard.view`. Action grants automatically include and lock their declared View/time dependencies, and the API rejects invalid combinations.
- Administrator is an immutable system role with implicit full access. Non-administrators may receive `roles.view`, but role creation, editing, and deletion remain Administrator-only.
- Task permissions are intentionally split across metadata, status, comments, logged time, subtasks, assignment, estimates, email, and archive. Hide or make read-only each independent control rather than treating `tasks.edit` as a blanket grant.
- A user whose stored role is invalid or empty retains only Profile and Sign out until an administrator repairs the role.

### Single-client mode

- Hide Clients navigation.
- Remove client selectors from relevant create/edit forms.
- Inject the configured client automatically.
- Provide the existing explanatory state if the client directory is reached directly.

### Work-session gating

- Every granted task write—creation, metadata, status, comments, logged time, subtasks, assignment, estimates, email mutations, and archive/restore—must honor the active work-session rule.
- Use `ClockGate` to explain why an action is unavailable and provide the clock-in action.
- Administrators may use an explicit override only where the product already allows it; never apply it silently.
- Keep sidebar and topbar timer states synchronized.

### Archive versus delete

- Projects, clients, contacts, users, and tasks use Archive → Archived view → Restore.
- Roles, removable fields, and disposable definition values may use Delete.
- Archived task details are read-only.

### Configurable field values

- Status, urgency, task type, and department should use reusable field values where supported.
- Render supplied labels and colors through `StatusBadge`.
- Do not duplicate configurable values as hard-coded visual constants in a new screen.

## Responsive contract

Use the existing breakpoints. Do not add arbitrary near-duplicate breakpoints for one component.

### `≤1100px`

- Four-column metrics become two columns.
- Permission grids become two columns.
- Message list narrows from 360px to 320px.
- Login proportions tighten and story metrics stack.

### `≤820px`

- Sidebar becomes a 244px off-canvas drawer with scrim.
- Main content loses its sidebar offset.
- Mobile-menu action appears.
- Topbar padding becomes 16px.
- Page padding becomes `25px 19px 45px`.
- Message panes narrow.
- Login story is hidden and the form fills the viewport.

### `≤640px`

- Global search collapses to a 38px icon control and expands when focused.
- Timer text hides while its state remains accessible.
- Page header and page actions stack; the main page action becomes full width.
- Metric, summary, chart, analytics, profile, and settings grids become one column.
- Toolbars stack; filter and tab rows scroll horizontally.
- Forms and permission grids become one column.
- Modals become bottom sheets with 16px top corners and `90vh` maximum height.
- Master-detail content stacks vertically.
- Settings section navigation becomes a horizontal scroller.
- Nonessential activity timestamps may hide.

The document minimum width is `320px`. Dense tables keep their intrinsic width and scroll; do not crush columns into unreadable cards unless a new, intentional mobile table pattern is introduced globally.

## Motion and feedback

- Standard transitions: about `.18s`.
- Popover entrance: about `.14s`.
- Sidebar drawer: about `.22s`; scrim: `.20s`.
- Motion should communicate layering or hoverability, never delay task completion.
- Keep hover lift to 1–2px and avoid spring, bounce, parallax, or large zoom effects.
- Respect reduced-motion preferences when adding any new nontrivial animation.

## Accessibility contract

Preserve and improve the current semantic approach:

- Use real `main`, `header`, `nav`, `section`, `table`, `form`, `label`, `button`, and `a` elements.
- Every control needs a stable accessible name; placeholders are not a sufficient label.
- Icon-only actions require `aria-label`; decorative icons remain `aria-hidden`.
- Errors use `role="alert"`; success and background loading updates should use an appropriate live region.
- Clickable table rows support Enter and Space, but important row actions remain real buttons.
- Status meaning includes text and does not rely on color.
- Dialogs use `role="dialog"`, `aria-modal`, a title, initial focus, a focus trap, Escape close, and focus return.
- Popover triggers expose `aria-expanded` and close on outside click/Escape.
- Tabs use full ARIA tab semantics and keyboard behavior.
- Preserve visible token-based focus rings in both themes.
- Maintain useful touch targets; the 36–40px controls are the current minimum, not a target to shrink.

Current gaps such as missing modal focus management, popover expanded state, and tab semantics should be improved in new or touched components—not copied for consistency.

## Content and terminology

- Use sentence case for headings, buttons, tabs, and table columns.
- Eyebrows are short category labels: `Overview`, `Delivery`, `Relationships`, `Directory`, `Reporting`, `Administration`.
- Page descriptions are one calm sentence, normally under 100 characters.
- Prefer plain product words: task, project, client, contact, person, time, message, field.
- Keep labels concise and explicit. Avoid clever error messages in workflows.
- Use an em dash for genuinely absent table data.
- Use localized display dates and ISO-compatible native date inputs.
- Use `Minutes` for durations so `0m`, `25m`, and `2h 5m` stay consistent.
- Use `·` to join related secondary context and `/` for breadcrumb hierarchy.

## Screen map

| Route | Eyebrow | Pattern |
| --- | --- | --- |
| `/login` | Welcome back | Authentication story/form |
| `/` | Overview | Dashboard/report |
| `/messages` | Communication | Master-detail inbox |
| `/tasks` | Work queue | Filterable collection |
| `/tasks/:taskId` | Context breadcrumb | Rich task workspace |
| `/projects` | Delivery | Collection |
| `/clients` | Relationships | Collection |
| `/contacts` | Directory | Collection |
| `/analytics` | Reporting | Report |
| `/settings` | Administration | Sectioned settings form |
| `/settings/users` | Administration | Collection + settings nav |
| `/settings/roles` | Administration | Collection + permissions form |
| `/settings/fields` | Administration | Collection + nested value editor |
| `/profile` | Your account | Identity card + form |

## Existing inconsistencies: improve, do not copy

- Settings subnavigation does not currently show an active route. New work should use active-state navigation.
- Some list filters are URL-backed while others are local. Prefer URL state when it helps sharing, refresh, or Back/Forward behavior.
- Some error banners have retry actions and others do not. Add retry whenever the failed read can safely be repeated.
- Dashboard and Analytics may briefly show empty chart copy while loading. Keep loading and empty states mutually exclusive.
- The shared large `EmptyState` always uses a search icon. Choose or add a context-appropriate icon when evolving it.
- Some current popovers, tabs, and modals have accessibility gaps listed above. Improve the shared primitive instead of reproducing the gap.
- Avoid conditionally adding lookup-backed form fields after `EntityForm` has initialized; mount a stable field list.

## New feature implementation checklist

Before merging a frontend feature, verify:

- [ ] It uses the shared shell and an existing canonical page pattern.
- [ ] It reuses shared UI primitives and the in-repo icon family.
- [ ] All visual colors come from tokens or data-driven status colors.
- [ ] Dark and light themes both remain legible.
- [ ] Desktop, `1100px`, `820px`, `640px`, and `320px` behavior is intentional.
- [ ] Primary, quiet, danger, and icon actions follow the hierarchy above.
- [ ] Permission checks cover route, navigation, and actions.
- [ ] Single-client behavior is handled where client context is involved.
- [ ] Task mutations honor clock gating and explicit admin override rules.
- [ ] Search/filter/page state resets or URL synchronization are correct.
- [ ] Loading, empty, error, success, busy, archived/read-only, and permission-limited states are covered.
- [ ] Forms remain stable while async lookup data arrives.
- [ ] Archive/delete terminology and confirmation match the data lifecycle.
- [ ] Controls have accessible names, keyboard behavior, focus treatment, and non-color state cues.
- [ ] Copy uses the established calm, concise terminology.
- [ ] Frontend lint and production build pass.
- [ ] The feature is exercised in a real browser at desktop and mobile widths.
