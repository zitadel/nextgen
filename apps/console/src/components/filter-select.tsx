import { Plus, X } from "lucide-react";
import { type ReactNode, useRef } from "react";

import { IdText } from "@/components/id-text";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";

/** A select trigger whose value is a row of pieces: it shrinks to its box, 6px apart. */
export const VALUE_ROW_TRIGGER =
  "max-w-full min-w-0 gap-1.5 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:gap-1.5";

/** The design's 36px outline control: 10px inset, 6px gaps inside and out, medium label. */
const CONTROL = `${VALUE_ROW_TRIGGER} px-2.5 font-medium`;

/**
 * One filter on a list's title row (Users, Logs): `+ Label` while unset,
 * `× Label value` once set, where the cross clears it. The cross is a button
 * of its own laid over the trigger's leading icon, since a button cannot sit
 * inside the trigger. It comes first in the DOM, as it is drawn, and hands
 * focus to the trigger once it clears.
 */
export function FilterSelect({
  label,
  name,
  value,
  display,
  disabled,
  onChange,
  menuClassName,
  children,
}: {
  label: string;
  /** What the filter narrows by, in the controls' accessible names. */
  name: string;
  value: string | undefined;
  display: ReactNode;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  menuClassName?: string;
  children: ReactNode;
}) {
  const Glyph = value ? X : Plus;
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative min-w-0">
      {value && (
        <button
          type="button"
          aria-label={`Clear the ${name} filter`}
          className="absolute top-1/2 left-1.5 z-10 size-6 -translate-y-1/2 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => {
            onChange(undefined);
            trigger.current?.focus();
          }}
        />
      )}
      <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          ref={trigger}
          aria-label={`Filter by ${name}`}
          // A filter has no chevron: the leading plus or cross is its glyph.
          // Unset, the label is the placeholder, in the foreground colour.
          className={`${CONTROL} data-[placeholder]:text-foreground [&>svg:last-child]:hidden`}
        >
          <Glyph aria-hidden className="text-foreground" />
          <SelectValue placeholder={label}>
            <span className="text-muted-foreground">{label}</span>
            {display}
          </SelectValue>
        </SelectTrigger>
        <SelectContent position="popper" align="end" className={menuClassName}>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * A filter set from elsewhere (a row's menu, a link on a detail screen), which
 * has no menu to choose from: a set {@link FilterSelect} as it is drawn,
 * `× Label value`, and the whole control clears it. The value is an id, cut
 * in the middle when the row has no room for it.
 */
export function FilterValue({
  label,
  name,
  value,
  onClear,
}: {
  label: string;
  /** What the filter narrows by, in the control's accessible name. */
  name: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Clear the ${name} filter`}
      onClick={onClear}
      // The select trigger's own outline, fill and focus ring, so a set
      // filter reads the same whether or not it has a menu.
      className="border-input hover:bg-accent dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 max-w-64 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
    >
      <X aria-hidden className="text-foreground size-4 shrink-0" />
      <span className="text-muted-foreground shrink-0">{label}</span>
      <IdText id={value} title={value} className="text-foreground" />
    </button>
  );
}
