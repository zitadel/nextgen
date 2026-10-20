"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { Component } from "./releases";

type Filter = {
  components: (Component & { count: number })[];
  /** The component the page shows the changes of, or none for every change. */
  selected?: Component;
  select: (id?: string) => void;
};

const FilterContext = createContext<Filter>({ components: [], select: () => {} });

// The query that holds the choice, so a filtered page can be shared:
// /changelog?component=cli.
const PARAM = "component";

/**
 * The changelog's filter by component. The page is static and holds every
 * change; once it runs, the filter hides what does not touch the chosen
 * component. The choice comes from the query and goes back into it.
 */
export function ComponentFilterProvider({
  components,
  children,
}: {
  components: Filter["components"];
  children: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [fromQuery, setFromQuery] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(location.search).get(PARAM);
    if (id) {
      setSelectedId(id);
      setFromQuery(true);
    }
  }, []);

  // The browser scrolls to a linked release (#v1.0.0-alpha.25) before the
  // query's filter hides the changes above it: back to the release, then.
  useEffect(() => {
    if (!fromQuery || !location.hash) return;
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView({ behavior: "instant" });
  }, [fromQuery]);

  const select = (id?: string) => {
    setSelectedId(id);
    const url = new URL(location.href);
    if (id) {
      url.searchParams.set(PARAM, id);
    } else {
      url.searchParams.delete(PARAM);
    }
    history.replaceState(null, "", url);
  };

  const selected = components.find((component) => component.id === selectedId);
  return <FilterContext value={{ components, selected, select }}>{children}</FilterContext>;
}

/** The filter's buttons: every change, then each component with its count. */
export function ComponentFilter() {
  const { components, selected, select } = useContext(FilterContext);
  return (
    <fieldset>
      <legend className="font-mono text-text-muted text-xs leading-4">Component</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        <FilterButton pressed={!selected} onClick={() => select()}>
          All
        </FilterButton>
        {components.map((component) => (
          <FilterButton
            key={component.id}
            pressed={selected?.id === component.id}
            onClick={() => select(component.id)}
          >
            {component.label}
            <span className="font-mono opacity-60">{component.count}</span>
          </FilterButton>
        ))}
      </div>
    </fieldset>
  );
}

function FilterButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 font-semibold text-xs transition-colors ${
        pressed
          ? "border-transparent bg-text-primary text-background"
          : "border-window-border text-text-secondary hover:bg-tint/[0.06] hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

/** Its children if they touch the chosen component, or no component is chosen. */
export function Filtered({ components, children }: { components: string[]; children: ReactNode }) {
  const { selected } = useContext(FilterContext);
  return !selected || components.includes(selected.id) ? children : null;
}

/** How many of a release's changes show, given the components of each. */
export function ChangeCount({ changes }: { changes: string[][] }) {
  const { selected } = useContext(FilterContext);
  const noun = changes.length === 1 ? "change" : "changes";
  if (!selected) return `${changes.length} ${noun}`;
  const shown = changes.filter((components) => components.includes(selected.id)).length;
  return `${shown} of ${changes.length} ${noun}`;
}

/** Says so when none of a release's changes touch the chosen component. */
export function NoneFiltered({ changes }: { changes: string[][] }) {
  const { selected } = useContext(FilterContext);
  if (!selected || changes.some((components) => components.includes(selected.id))) return null;
  return (
    <p className="text-sm text-text-muted leading-6">
      No change to {selected.label} in this release.
    </p>
  );
}
