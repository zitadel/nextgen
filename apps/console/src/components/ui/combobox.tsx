import { Check, ChevronDown, X } from "lucide-react"
import * as React from "react"
import { type ReactNode, useState } from "react"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Combobox — a single shared implementation of the design system's `Combobox`
 * family, so callers compose it rather than re-deriving it per screen.
 *
 * shadcn documents the Combobox for this project's `new-york` style as a
 * composition of `Popover` + `Command` rather than shipping a component for it
 * (`registry/new-york-v4/examples/combobox-demo.tsx`); the standalone
 * `registry:ui` combobox belongs to shadcn's newer Base UI track, which this
 * console does not use. This file is that composition, done once.
 *
 * Geometry comes from the design system file (`HToNyqKwShDmqVurU7Xbld`), not from
 * instances on a screen mock — the mock wires `Select`-shaped triggers to
 * Combobox menus, so its trigger differs from the canonical one:
 *
 * - `Combobox / Item` (`430:4114`) — the trigger. `Type=Default | Multiple |
 *   Invalid` × `Default | Active | Focus | Disabled`. `h-9`, `gap-1.5`,
 *   `pl-2.5 pr-1 py-1`, `rounded-md`, `border-input`, `shadow-xs`,
 *   `bg-background dark:bg-input/30`; optional inline addon glyph at 50% opacity;
 *   trailing 24px box holding a 12px chevron.
 * - `Combobox / Combobox List` (`21473:103072`) — `rounded-lg`, `bg-popover`,
 *   `shadow-md`, hairline in `foreground/10`.
 * - `Combobox / Menu Item` (`17379:199232`) — `Type=Simple` (32px, one line) and
 *   `Type=Custom` (48px, label over description).
 * - `Multiple Selection Item` (`21180:30054`) — the removable chip.
 */

const TRIGGER_BASE =
  "flex h-9 items-center gap-1.5 rounded-md border border-input bg-background py-1 pr-1 pl-2.5 text-sm shadow-xs outline-none dark:bg-input/30"
const TRIGGER_INTERACTIVE =
  "cursor-pointer focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const TRIGGER_DISABLED = "cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80"
const TRIGGER_INVALID =
  "border-destructive ring-destructive/20 dark:ring-destructive/40 aria-invalid:ring-[3px]"

const LIST = "w-(--radix-popover-trigger-width) rounded-lg border-foreground/10 p-0"

// `Type=Simple` is one 32px line; `Type=Custom` stacks a 14px label over a 12px
// description and measures 48px.
const ITEM_SIMPLE = "h-8 gap-1.5 rounded-sm py-1.5 pr-8 pl-2"
const ITEM_CUSTOM = "gap-1.5 rounded-sm py-1.5 pr-8 pl-2"
// cmdk marks an item active as soon as the list mounts, but every state of
// `Combobox / Menu Item` renders transparent — a resting list must not paint a
// filled row, so the fill is suppressed until the operator points or arrows.
const ITEM_RESTING = "data-[selected=true]:bg-transparent"

const CHIP =
  "flex h-[21px] shrink-0 items-center gap-1 rounded-sm bg-muted pl-1.5 text-xs leading-none font-medium text-foreground"
const CHIP_REMOVE = "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md"

/** The trailing affordance: a 24px box holding a 12px chevron. */
function ComboboxChevron() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md">
      <ChevronDown className="size-3 opacity-50" aria-hidden />
    </span>
  )
}

/**
 * A `Combobox / Item` trigger. `asChild`-style composition is deliberately not
 * used: the multiple variant nests remove buttons, so the trigger is a container
 * with combobox semantics rather than a `<button>`.
 */
export function ComboboxTrigger({
  label,
  open,
  disabled,
  invalid,
  addon,
  className,
  children,
  onOpen,
  onKeyDown,
  ...props
}: React.ComponentProps<"div"> & {
  /** Accessible name — the control's own label, e.g. "Select project". */
  label: string
  open: boolean
  disabled?: boolean
  invalid?: boolean
  /** Optional inline glyph, rendered at 50% opacity per the addon slot. */
  addon?: ReactNode
  onOpen: () => void
}) {
  return (
    // `props` carries what `PopoverTrigger asChild` injects (click handler, ref,
    // `data-state`); dropping it would leave the trigger inert.
    <div
      {...props}
      role="combobox"
      aria-expanded={open}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-invalid={invalid || undefined}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        TRIGGER_BASE,
        disabled ? TRIGGER_DISABLED : TRIGGER_INTERACTIVE,
        invalid && TRIGGER_INVALID,
        className,
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (disabled) return
        // WAI-ARIA's combobox pattern opens on Enter, Space and either arrow —
        // arrow-to-open is what a keyboard user reaches for first.
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown" ||
          event.key === "ArrowUp"
        ) {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      {addon && (
        <span className="flex shrink-0 items-center opacity-50" aria-hidden>
          {addon}
        </span>
      )}
      {children}
      <ComboboxChevron />
    </div>
  )
}

/** Placeholder text inside a trigger. */
export function ComboboxPlaceholder({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{children}</span>
}

/** The chosen single value inside a trigger. */
export function ComboboxValue({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate text-left">{children}</span>
}

/** `Multiple Selection Items` — the chip rail inside a multiple trigger. */
export function ComboboxChips({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{children}</span>
  )
}

/** `Multiple Selection Item` — one removable chip. */
export function ComboboxChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className={CHIP}>
      <span className="truncate">{label}</span>
      <button
        type="button"
        className={CHIP_REMOVE}
        aria-label={`Remove ${label}`}
        // The chip sits inside the trigger; without this the click would also
        // toggle the popover.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  )
}

export interface ComboboxOption {
  value: string
  label: string
  /** Second line — renders the `Type=Custom` 48px row. */
  description?: string
  /** Optional leading glyph for the row. */
  icon?: ReactNode
}

/**
 * The popover list: search field, empty state, and rows. `selected` drives the
 * chosen affordance, which differs by usage — the project list fills the chosen
 * row (`Row · River`), while schema and role lists mark it with a Check.
 */
export function ComboboxContent({
  options,
  selected,
  searchPlaceholder,
  emptyLabel,
  indicator = "check",
  onSelect,
  /** Keep the popover open on select — multiple selection accumulates. */
  closeOnSelect = true,
  onClose,
}: {
  options: ComboboxOption[]
  selected: string[]
  searchPlaceholder: string
  emptyLabel: string
  indicator?: "check" | "fill"
  onSelect: (value: string) => void
  closeOnSelect?: boolean
  onClose: () => void
}) {
  const [navigating, setNavigating] = useState(false)

  return (
    <PopoverContent align="start" className={LIST}>
      <Command
        onPointerMove={() => setNavigating(true)}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key.startsWith("Arrow")) setNavigating(true)
        }}
      >
        <CommandInput variant="boxed" placeholder={searchPlaceholder} />
        <CommandList>
          <CommandEmpty>{emptyLabel}</CommandEmpty>
          <CommandGroup>
            {options.map((option) => {
              const isSelected = selected.includes(option.value)
              return (
                <CommandItem
                  key={option.value}
                  // Search matches the label and the description, so typing a
                  // property name finds the schemas that collect it.
                  value={`${option.label} ${option.description ?? ""}`}
                  className={cn(
                    option.description ? ITEM_CUSTOM : ITEM_SIMPLE,
                    !navigating && ITEM_RESTING,
                    isSelected && indicator === "fill" && "bg-accent text-accent-foreground",
                  )}
                  onSelect={() => {
                    onSelect(option.value)
                    if (closeOnSelect) onClose()
                  }}
                >
                  {option.icon}
                  {option.description ? (
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">{option.label}</span>
                      <span className="truncate text-xs leading-4 text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  )}
                  {isSelected && indicator === "check" && (
                    <Check className="absolute right-2 size-4" aria-hidden />
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  )
}

export { Popover as Combobox, PopoverTrigger as ComboboxAnchor }
