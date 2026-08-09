/**
 * The `?` shortcut sheet.
 *
 * Two columns of key and meaning, in the order the design lists them — which
 * is roughly the order a person meets them: search first, then moving, then
 * acting.
 */
const SHORTCUTS: Array<[key: string, label: string]> = [
  ['⌘K', 'Search & commands'],
  ['N', 'New task'],
  ['J K', 'Move'],
  ['↵', 'Open'],
  ['X', 'Select'],
  ['D', 'Toggle done'],
  ['1–5', 'Jump to view'],
  ['B', 'Break / resume'],
  ['?', 'Shortcuts'],
  ['Esc', 'Back out'],
]

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[75] grid place-items-center">
      <button
        type="button"
        aria-label="Close shortcuts"
        onClick={onClose}
        className="absolute inset-0 animate-in fade-in duration-150 bg-[rgba(4,4,6,0.6)]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="relative w-[480px] max-w-[calc(100vw-40px)] rounded-[14px] border border-line-strong bg-elev-low px-6 pb-6 pt-[22px] shadow-overlay"
      >
        <h3 className="mb-[18px] text-[14px] font-semibold tracking-[-0.01em] text-title-strong">Shortcuts</h3>
        <div className="grid grid-cols-2 gap-x-7">
          {SHORTCUTS.map(([key, label]) => (
            <div key={key} className="flex items-center gap-[11px] py-1.5">
              <span className="min-w-[34px] rounded-[5px] bg-fill px-1.5 py-[3px] text-center font-mono text-[10.5px] text-t2">
                {key}
              </span>
              <span className="text-body-sm text-[#6e6e78]">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
