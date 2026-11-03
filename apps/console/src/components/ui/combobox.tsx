import { Check, ChevronDown, X } from "lucide-react";
import type * as React from "react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
 * Geometry comes from the design system's Combobox, not from
 * instances on a screen mock — the mock wires `Select`-shaped triggers to
 * Combobox menus, so its trigger differs from the canonical one:
 *
 * - Trigger: default, multiple or invalid, each resting, active, focused or
 *   disabled. `h-9`, `gap-1.5`,
 *   `pl-2.5 pr-1 py-1`, `rounded-md`, `border-input`, `shadow-xs`,
 *   `bg-background dark:bg-input/30`; optional inline addon glyph at 50% opacity;
 *   trailing 24px box holding a 12px chevron.
 * - List: `rounded-md`, `bg-popover`,
 *   `shadow-md`, hairline in `foreground/10`.
 * - Menu item: one-line (32px) and two-line (48px, label over description).
 * - Chip: the removable selection in a multiple trigger.
 */

const TRIGGER_BASE =
  "flex h-9 items-center gap-1.5 rounded-md border border-input bg-background py-1 pr-1 pl-2.5 text-sm shadow-xs outline-none dark:bg-input/30";
const TRIGGER_INTERACTIVE =
  "cursor-pointer focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const TRIGGER_DISABLED = "cursor-not-allowed bg-input/50 opacity-50 dark:bg-input/80";
const TRIGGER_INVALID =
  "border-destructive ring-destructive/20 dark:ring-destructive/40 aria-invalid:ring-[3px]";

const LIST = "w-(--radix-popover-trigger-width) rounded-md border-foreground/10 p-0";

// One-line is 32px; two-line stacks a 14px label over a 12px description and
// measures 48px.
const ITEM_SIMPLE = "h-8 gap-1.5 rounded-sm py-1.5 pr-8 pl-2";
const ITEM_CUSTOM = "gap-1.5 rounded-sm py-1.5 pr-8 pl-2";
// cmdk marks an item active as soon as the list mounts, but every state of
// the design's menu item renders transparent — a resting list must not paint a
// filled row, so the fill is suppressed until the operator points or arrows.
const ITEM_RESTING = "data-[selected=true]:bg-transparent";

const CHIP =
  "flex h-[21px] shrink-0 items-center gap-1 rounded-sm bg-muted pl-1.5 text-xs leading-none font-medium text-foreground";
const CHIP_REMOVE = "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md";

/** The trailing affordance: a 24px box holding a 12px chevron. */
function ComboboxChevron() {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md">
      <ChevronDown className="size-3 opacity-50" aria-hidden />
    </span>
  );
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
  label: string;
  open: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Optional inline glyph, rendered at 50% opacity per the addon slot. */
  addon?: ReactNode;
  onOpen: () => void;
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
        onKeyDown?.(event);
        if (disabled) return;
        // WAI-ARIA's combobox pattern opens on Enter, Space and either arrow —
        // arrow-to-open is what a keyboard user reaches for first.
        if (
          event.key === "Enter" ||
          event.key === " " ||
          event.key === "ArrowDown" ||
          event.key === "ArrowUp"
        ) {
          event.preventDefault();
          onOpen();
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
  );
}

/** Placeholder text inside a trigger. */
export function ComboboxPlaceholder({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">{children}</span>
  );
}

/** The chosen single value inside a trigger. */
export function ComboboxValue({ children }: { children: ReactNode }) {
  return <span className="min-w-0 flex-1 truncate text-left">{children}</span>;
}

/** `Multiple Selection Items` — the chip rail inside a multiple trigger. */
export function ComboboxChips({ children }: { children: ReactNode }) {
  return <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">{children}</span>;
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
          event.stopPropagation();
          onRemove();
        }}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line — renders the two-line 48px row. */
  description?: string;
  /** Optional leading glyph for the row. */
  icon?: ReactNode;
}

/** A run of rows under a caption, as the design's menu label draws it. */
export interface ComboboxGroup {
  heading?: string;
  options: ComboboxOption[];
}

/**
 * The caption: the design's menu label (`PROJECTS`), set in capitals rather
 * than written in them, so the heading stays readable to assistive technology.
 */
const GROUP = "[&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:uppercase";

/** What the list says when it has no rows: `CommandEmpty`'s own look. */
const EMPTY = "py-6 text-center text-sm";

/** The footer row's cmdk value, apart from the ids and names options carry. */
const FOOTER_VALUE = "combobox:footer";

/**
 * The popover list: search field, empty state, and rows, in captioned groups
 * when asked, over an optional footer action. `selected` drives the chosen
 * affordance, which differs by usage — the project list fills the chosen row
 * (`Row · River`), while schema and role lists mark it with a Check.
 */
export function ComboboxContent({
  options,
  groups,
  selected,
  searchPlaceholder,
  emptyLabel,
  indicator = "check",
  onSelect,
  /** Keep the popover open on select — multiple selection accumulates. */
  closeOnSelect = true,
  onClose,
  search,
  footer,
  label,
  className,
}: {
  /** The rows, in one group without a caption. Pass `options` or `groups`. */
  options?: ComboboxOption[];
  /** The rows in captioned groups, in order. An empty group is left out. */
  groups?: ComboboxGroup[];
  selected: string[];
  searchPlaceholder: string;
  emptyLabel: string;
  indicator?: "check" | "fill";
  onSelect: (value: string) => void;
  closeOnSelect?: boolean;
  onClose: () => void;
  /**
   * The caller searches: the field shows `query`, and the rows are the caller's
   * answer to it, not cmdk's filtering of them. For a list whose rows come from
   * a server search, which reaches past what the caller holds.
   */
  search?: { query: string; onQueryChange: (query: string) => void };
  /** An action beneath the rows, reached by arrow like them; it closes the list. */
  footer?: { label: string; icon?: ReactNode; onSelect: () => void };
  /** The list's accessible name. */
  label?: string;
  /** For the popover: by default it is as wide as its trigger. */
  className?: string;
}) {
  const [navigating, setNavigating] = useState(false);
  const sections = (groups ?? [{ options: options ?? [] }]).filter(
    (group) => group.options.length > 0,
  );

  // The row cmdk highlights, which Enter picks — held here for a caller's
  // search. Its rows land after the typing that asked for them, and cmdk
  // highlights the first row the moment the query changes, which may be the
  // footer, the only row there was; it keeps that when the matches arrive.
  // So when the rows change and the highlight is not on one, it moves to the
  // first match, as cmdk's own filtering would have put it.
  const [highlight, setHighlight] = useState("");
  const rowValues = sections.flatMap((group) => group.options.map((option) => option.value));
  const rowsKey = rowValues.join("\n");
  const lastRows = useRef(rowsKey);
  useEffect(() => {
    if (!search || lastRows.current === rowsKey) return;
    lastRows.current = rowsKey;
    const first = rowValues[0];
    if (first !== undefined && !rowValues.includes(highlight)) setHighlight(first);
  }, [search, rowsKey, rowValues, highlight]);

  return (
    <PopoverContent align="start" className={cn(LIST, className)}>
      <Command
        // The field's name: cmdk labels its input with this (`aria-labelledby`),
        // which an `aria-label` on the input would not outrank.
        label={searchPlaceholder}
        shouldFilter={!search}
        {...(search && { value: highlight, onValueChange: setHighlight })}
        onPointerMove={() => setNavigating(true)}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key.startsWith("Arrow")) setNavigating(true);
        }}
      >
        <CommandInput
          variant="boxed"
          placeholder={searchPlaceholder}
          // Typing is interaction too: the first match is then what Enter
          // picks, so its row may show it.
          onValueChange={(query) => {
            if (query) setNavigating(true);
            search?.onQueryChange(query);
          }}
          {...(search && { value: search.query })}
        />
        <CommandList label={label}>
          {/* cmdk's empty state counts the rows it shows, and it shows every
              row of a caller's search, the footer among them, so it would
              never say there are no matches. */}
          {search ? (
            sections.length === 0 && (
              <div role="presentation" className={EMPTY}>
                {emptyLabel}
              </div>
            )
          ) : (
            <CommandEmpty>{emptyLabel}</CommandEmpty>
          )}
          {sections.map((group, index) => (
            <CommandGroup key={group.heading ?? index} heading={group.heading} className={GROUP}>
              {group.options.map((option) => {
                const isSelected = selected.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    // The value is cmdk's name for the row, so it must be unique:
                    // two schemas or projects may share a label. Search matches
                    // the label and the description, so typing a property name
                    // finds the schemas that collect it.
                    value={option.value}
                    keywords={
                      option.description ? [option.label, option.description] : [option.label]
                    }
                    className={cn(
                      option.description ? ITEM_CUSTOM : ITEM_SIMPLE,
                      !navigating && ITEM_RESTING,
                      isSelected && indicator === "fill" && "bg-accent text-accent-foreground",
                    )}
                    onSelect={() => {
                      onSelect(option.value);
                      if (closeOnSelect) onClose();
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
                );
              })}
            </CommandGroup>
          ))}
          {footer && (
            <>
              {/* `foreground/10`, as the account menu's hairlines: `border` is
                  the popover's own colour on the dark theme and would not show. */}
              <CommandSeparator alwaysRender className="bg-foreground/10" />
              <CommandGroup>
                <CommandItem
                  // Shown whatever is typed: it is a way out, not a match.
                  forceMount
                  value={FOOTER_VALUE}
                  className={cn(ITEM_SIMPLE, !navigating && ITEM_RESTING)}
                  onSelect={() => {
                    onClose();
                    footer.onSelect();
                  }}
                >
                  {footer.icon}
                  <span className="min-w-0 flex-1 truncate">{footer.label}</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </Command>
    </PopoverContent>
  );
}

export { Popover as Combobox, PopoverTrigger as ComboboxAnchor };
