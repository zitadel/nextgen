import { Box, Building2, ChevronsUpDown, type LucideIcon, Plus, Search } from "lucide-react";
import { useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Org / project switchers — Figma `Sidebar / PopoverContextSwitcher`
 * (`j3qqriDab6WQfrlgLujf4Y`). Desktop: 196px `bg-card` pills side-by-side.
 * Mobile (`Dashboard xs`): full-width stacked rows. Built on shadcn `Popover`.
 */

interface SwitcherOption {
  id: string;
  label: string;
  plan?: string;
}

const ORGS: SwitcherOption[] = [
  { id: "acme", label: "Acme Inc", plan: "Free" },
  { id: "clearwater", label: "Clearwater Labs", plan: "Pro" },
  { id: "benimac", label: "Benimac LTD", plan: "Enterprise" },
  { id: "horizons", label: "Horizons Studio", plan: "Pro" },
];

const PROJECTS: SwitcherOption[] = [
  { id: "river", label: "River" },
  { id: "sea", label: "Sea-6677" },
  { id: "sand", label: "Sand-8899" },
  { id: "peak", label: "Peak-9901" },
];

export function ContextSwitcher() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:items-center">
      <Switcher
        icon={Building2}
        label="Acme Inc"
        shortLabel="Acme"
        plan="Free"
        options={ORGS}
        ariaLabel="Switch organization"
      />
      <Switcher icon={Box} label="River" options={PROJECTS} ariaLabel="Switch project" />
    </div>
  );
}

function Switcher({
  icon: Icon,
  label,
  shortLabel,
  plan,
  options,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  shortLabel?: string;
  plan?: string;
  options: SwitcherOption[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();

  const rows = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-12 w-full items-center gap-2 rounded-xs bg-card px-2 text-sm transition-colors hover:bg-accent md:h-10 md:w-[196px]",
          )}
        >
          <Icon size={16} className="shrink-0 text-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left font-serif text-foreground">
            <span className="md:hidden">{shortLabel ?? label}</span>
            <span className="hidden md:inline">{label}</span>
          </span>
          {plan && (
            <Badge variant="secondary" className="shrink-0">
              {plan}
            </Badge>
          )}
          <ChevronsUpDown size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-72 border-border bg-popover p-2 text-popover-foreground"
      >
        <div className="mb-1 flex items-center gap-2 rounded-sm border border-input px-3 py-2">
          <Search size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="search"
            name={`${listId}-search`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label={`${ariaLabel} search`}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        <ul id={listId} role="listbox" aria-label={ariaLabel} className="flex flex-col">
          {rows.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">No results</li>
          ) : (
            rows.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.label === label}
                  onClick={() => setOpen(false)}
                  className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left hover:bg-accent"
                >
                  <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                  <span className="flex-1 truncate text-sm text-foreground">{option.label}</span>
                  {option.plan && (
                    <Badge variant="secondary" className="shrink-0">
                      {option.plan}
                    </Badge>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>

        <div className="mt-1 border-t border-border pt-1">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-sm px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            Create team
            <Plus size={16} className="shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
