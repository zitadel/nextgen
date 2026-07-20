import { Box, Building2, ChevronsUpDown, type LucideIcon, Plus, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { Tag } from "../tag";

/**
 * Org / project switcher in the context bar. A console-local composition
 * (`apps/console/docs/styling.md`: app chrome is React + `zl-*` utilities, not a
 * Lit/React pair) built to the Figma "Context switcher" component
 * (`8UjCXw8yemgljmbkWGrSfE`, light `7126:17775` / dark `6932:82172`). Both modes
 * are the same markup — the semantic tokens flip with `data-theme`. Data is
 * dummy until the org/project APIs are wired.
 */

interface SwitcherOption {
  id: string;
  label: string;
  plan?: string;
}

const ORGS: SwitcherOption[] = [
  { id: "clearwater", label: "Clearwater Labs", plan: "Pro" },
  { id: "benimac", label: "Benimac LTD", plan: "Enterprise" },
  { id: "acme-corp", label: "Acme Corp", plan: "Free" },
  { id: "horizons", label: "Horizons Studio", plan: "Pro" },
];

const PROJECTS: SwitcherOption[] = [
  { id: "sea", label: "Sea-6677" },
  { id: "sand", label: "Sand-8899" },
  { id: "river", label: "River-1345" },
  { id: "peak", label: "Peak-9901" },
];

export function ContextSwitcher() {
  return (
    <div className="flex min-w-0 flex-col gap-2 lg:flex-row">
      <Switcher
        icon={Building2}
        label="Acme"
        plan="Free"
        options={ORGS}
        ariaLabel="Switch organization"
      />
      <Switcher icon={Box} label="All projects" plan="Free" options={PROJECTS} ariaLabel="Switch project" />
    </div>
  );
}

function Switcher({
  icon: Icon,
  label,
  plan,
  options,
  ariaLabel,
}: {
  icon: LucideIcon;
  label: string;
  plan: string;
  options: SwitcherOption[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const rows = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-11 w-full items-center gap-2 rounded-zl-s border px-4 text-sm transition-colors lg:w-auto ${
          open
            ? "border-zl-border-default bg-zl-surface-raised"
            : "border-transparent bg-zl-surface-subtle hover:bg-zl-surface-selected"
        }`}
      >
        <Icon size={16} className="shrink-0 text-zl-text-secondary" aria-hidden />
        <span className="truncate text-zl-text-primary lg:max-w-[200px]">{label}</span>
        <Tag className="shrink-0">{plan}</Tag>
        <ChevronsUpDown size={16} className="ml-auto shrink-0 text-zl-text-tertiary lg:ml-0" aria-hidden />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-72 rounded-zl-l border border-zl-border-subtle bg-zl-surface-overlay p-2 shadow-lg">
          <div className="mb-1 flex items-center gap-2 rounded-zl-xs border border-zl-border-default bg-zl-surface-raised px-3 py-2">
            <Search size={16} className="shrink-0 text-zl-text-secondary" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search"
              aria-label={`${ariaLabel} search`}
              className="w-full bg-transparent text-sm text-zl-text-primary placeholder:text-zl-text-secondary focus:outline-none"
            />
          </div>

          <ul id={listId} role="listbox" aria-label={ariaLabel} className="flex flex-col">
            {rows.length === 0 ? (
              <li className="px-3 py-2.5 text-sm text-zl-text-secondary">No results</li>
            ) : (
              rows.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => setOpen(false)}
                    className="flex w-full items-center gap-3 rounded-zl-xs px-3 py-2.5 text-left hover:bg-zl-surface-subtle"
                  >
                    <Icon size={16} className="shrink-0 text-zl-text-secondary" aria-hidden />
                    <span className="flex-1 truncate text-sm text-zl-text-primary">{option.label}</span>
                    {option.plan && <Tag className="shrink-0">{option.plan}</Tag>}
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="mt-1 border-t border-zl-border-subtle pt-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-zl-xs px-3 py-2.5 text-sm font-semibold text-zl-text-primary hover:bg-zl-surface-subtle"
            >
              Create team
              <Plus size={16} className="shrink-0 text-zl-text-secondary" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
