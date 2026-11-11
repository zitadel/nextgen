import { Check, ChevronLeft, ChevronRight, ListFilter, X } from "lucide-react";
import { type ReactElement, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DATE_RANGE_LABEL,
  DATE_RANGES,
  type DateFilter,
  dateFilterLabel,
  type FilterDefinition,
  type FilterValues,
  filterName,
  type OptionsFilter,
  parseDateFilter,
  today,
} from "@/lib/resource-filter";
import { cn } from "@/lib/utils";

/**
 * A list's filter, for `ResourceTitle`'s `below` row: **Add filter** lists
 * the properties the resource can be narrowed by, and choosing one swaps the
 * menu for that property's values, drawn by its type (`FilterDefinition`): a
 * searchable list for a set of options, ranges and a day for a date. Each
 * filter that is set is a chip beside the button: its body reopens the values,
 * its cross clears it.
 *
 * The component knows no resource. A screen describes its properties as
 * definitions (`src/features/users/filters.tsx` is the example to copy), keeps
 * the values in its URL, and merges each `onChange` patch into them. The
 * server does the narrowing, so nothing here counts or filters rows.
 *
 * A value no option matches (a link kept after its schema was deleted) still
 * shows on its chip, so it can be cleared.
 */
export function ResourceFilter({
  filters,
  values,
  onChange,
}: {
  filters: FilterDefinition[];
  values: FilterValues;
  /** The keys that change, a cleared one as `undefined`; the screen merges it into its search. */
  onChange: (patch: Record<string, string | undefined>) => void;
}) {
  const add = useRef<HTMLButtonElement>(null);
  const set = (filter: FilterDefinition, value: string | undefined) => {
    const patch: Record<string, string | undefined> = {};
    for (const key of filter.clears ?? []) patch[key] = undefined;
    patch[filter.key] = value;
    onChange(patch);
  };

  return (
    <>
      <FilterMenu filters={filters} values={values} onPick={set}>
        <Button ref={add} variant="outline" className="shrink-0 gap-1.5 px-2.5!">
          <ListFilter aria-hidden />
          Add filter
        </Button>
      </FilterMenu>
      {filters.map((filter) => {
        const value = values[filter.key];
        if (!value) return null;
        const name = filterName(filter);
        return (
          // The Add button's own surface, as one control. Its two parts are
          // inset in it, so each one's hover fill is a rounded box of its own
          // rather than a half of the chip cut at the seam.
          // biome-ignore lint/a11y/useSemanticElements: two buttons drawn as one control, not a <fieldset> of form fields
          <div
            key={filter.key}
            role="group"
            aria-label={`${filter.label} filter`}
            className="bg-background dark:border-input dark:bg-input/30 flex h-9 max-w-full min-w-0 items-center rounded-md border pr-1 pl-1.5 text-sm font-medium shadow-xs"
          >
            <button
              type="button"
              aria-label={`Clear the ${name} filter`}
              className={cn(CHIP_PART, "size-6 shrink-0 justify-center")}
              onClick={() => {
                set(filter, undefined);
                // The chip goes with its filter, so focus goes to the button that stays.
                add.current?.focus();
              }}
            >
              <X aria-hidden className="size-4" />
            </button>
            <FilterMenu filters={filters} values={values} onPick={set} only={filter.key}>
              <button
                type="button"
                aria-label={`Filter by ${name}`}
                className={cn(CHIP_PART, "h-7 min-w-0 gap-1.5 px-1.5")}
              >
                <span className="text-muted-foreground">{filter.label}</span>
                <FilterValue filter={filter} value={value} />
              </button>
            </FilterMenu>
          </div>
        );
      })}
    </>
  );
}

const CHIP_PART =
  "flex items-center rounded-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:hover:bg-input/50";

/** A chosen value on its chip. */
function FilterValue({ filter, value }: { filter: FilterDefinition; value: string }) {
  if (filter.type === "date") return <span className="truncate">{dateFilterLabel(value)}</span>;
  if (filter.display) return filter.display(value);
  const label = filter.options.find((option) => option.value === value)?.label;
  return <span className="truncate">{label ?? value}</span>;
}

/** The menu's surface and rows: the Combobox list's (`ui/combobox.tsx`). */
const MENU = "border-foreground/10 w-64 rounded-md p-0";
const ITEM = "min-h-8 gap-1.5 rounded-sm py-1.5 pr-8 pl-2";

/**
 * The popover behind the Add button and behind each chip. From the button it
 * opens on the properties and steps into one; from a chip (`only`) it is that
 * property's values alone.
 */
function FilterMenu({
  filters,
  values,
  onPick,
  only,
  children,
}: {
  filters: FilterDefinition[];
  values: FilterValues;
  onPick: (filter: FilterDefinition, value: string) => void;
  only?: string;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<string>();
  const current = filters.find((filter) => filter.key === (only ?? step));
  const pick = (filter: FilterDefinition, value: string) => {
    setOpen(false);
    onPick(filter, value);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Every opening starts on the properties.
        if (next) setStep(undefined);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(MENU, current?.type === "options" && current.menuClassName)}
      >
        {!current ? (
          <Command label="Filter by">
            <CommandInput variant="boxed" placeholder="Filter by…" />
            <CommandList>
              <CommandEmpty>No such filter.</CommandEmpty>
              <CommandGroup>
                {filters.map((filter) => (
                  <CommandItem
                    key={filter.key}
                    value={filter.key}
                    keywords={[filter.label]}
                    disabled={!!filter.unavailable}
                    className={cn(ITEM, "pr-2")}
                    onSelect={() => setStep(filter.key)}
                  >
                    <span className="min-w-0 flex-1 truncate">{filter.label}</span>
                    {filter.unavailable ? (
                      <span className="text-muted-foreground text-xs">{filter.unavailable}</span>
                    ) : (
                      <ChevronRight aria-hidden />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <>
            {!only && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mx-1 mt-1 flex h-7 items-center gap-1 rounded-sm px-1 text-xs font-medium outline-none focus-visible:ring-[3px]"
                onClick={() => setStep(undefined)}
              >
                <ChevronLeft aria-hidden className="size-3.5" />
                All filters
              </button>
            )}
            {current.type === "options" ? (
              <OptionValues
                filter={current}
                value={values[current.key]}
                onPick={(value) => pick(current, value)}
              />
            ) : (
              <DateValues
                filter={current}
                value={values[current.key]}
                onPick={(value) => pick(current, value)}
              />
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A set of options: a searchable list, the chosen one checked. */
function OptionValues({
  filter,
  value,
  onPick,
}: {
  filter: OptionsFilter;
  value: string | undefined;
  onPick: (value: string) => void;
}) {
  return (
    <Command label={filter.label}>
      {/* Stepping in replaces the properties' field, which held the focus. */}
      <CommandInput autoFocus variant="boxed" placeholder={`${filter.label}…`} />
      <CommandList>
        <CommandEmpty>Nothing to choose.</CommandEmpty>
        <CommandGroup>
          {filter.options.map((option) => (
            <FilterRow
              key={option.value}
              option={option}
              chosen={option.value === value}
              onPick={onPick}
            />
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function FilterRow({
  option,
  chosen,
  onPick,
}: {
  option: OptionsFilter["options"][number];
  chosen: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <>
      <CommandItem
        value={option.value}
        keywords={[option.label, ...(option.keywords ?? [])]}
        title={option.title}
        // A row of two lines keeps the check mark on its first.
        className={cn(ITEM, "items-start")}
        onSelect={() => onPick(option.value)}
      >
        {option.content ?? (
          <span className="min-w-0 flex-1 truncate leading-5">{option.label}</span>
        )}
        {chosen && <Check aria-hidden className="absolute top-2 right-2 size-4" />}
      </CommandItem>
      {/* `foreground/10`, as the Combobox's footer: `border` does not show on a dark popover. */}
      {option.separated && <CommandSeparator className="bg-foreground/10 my-1" />}
    </>
  );
}

/**
 * A date: the ranges that end now, and under them a day to start from. The
 * day's form sits outside the list, whose Enter picks the highlighted range.
 */
function DateValues({
  filter,
  value,
  onPick,
}: {
  filter: DateFilter;
  value: string | undefined;
  onPick: (value: string) => void;
}) {
  const fieldId = useId();
  const [day, setDay] = useState(() =>
    value && !(DATE_RANGES as readonly string[]).includes(value) ? value : "",
  );
  const latest = today();
  const valid = parseDateFilter(day) !== undefined && day <= latest;

  return (
    <>
      <Command label={filter.label}>
        <CommandInput autoFocus variant="boxed" placeholder={`${filter.label}…`} />
        <CommandList>
          <CommandEmpty>No such range.</CommandEmpty>
          <CommandGroup>
            {DATE_RANGES.map((range) => (
              <FilterRow
                key={range}
                option={{ value: range, label: DATE_RANGE_LABEL[range] }}
                chosen={range === value}
                onPick={onPick}
              />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
      <form
        className="border-foreground/10 flex flex-col gap-1.5 border-t p-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onPick(day);
        }}
      >
        <label htmlFor={fieldId} className="text-muted-foreground text-xs font-medium">
          Since a day
        </label>
        <div className="flex gap-2">
          <Input
            id={fieldId}
            type="date"
            max={latest}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            className="h-8 min-w-0 flex-1 text-xs md:text-xs"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!valid}>
            Apply
          </Button>
        </div>
      </form>
    </>
  );
}
