"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { BUMP_LABELS, type Choice, type Component, type Facet, matches } from "./filter";
import type { Bump } from "./releases";

type Filter = {
  components: Component[];
  bumps: Bump[];
  /** Every change on the page, for the buttons' counts. */
  facets: Facet[];
  choice: Choice;
  choose: (choice: Choice) => void;
};

const FilterContext = createContext<Filter>({
  components: [],
  bumps: [],
  facets: [],
  choice: {},
  choose: () => {},
});

// The query that holds the choice, so a filtered page can be shared:
// /changelog?component=cli&change=minor.
const COMPONENT_PARAM = "component";
const BUMP_PARAM = "change";

/**
 * The changelog's filters, by component and by bump. The page is static and
 * holds every change; once it runs, the filters hide what does not match the
 * choice. The choice comes from the query and goes back into it.
 */
export function ChangelogFilter({
  components,
  bumps,
  facets,
  children,
}: Omit<Filter, "choice" | "choose"> & { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>({});
  const [fromQuery, setFromQuery] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const component = components.find(({ id }) => id === query.get(COMPONENT_PARAM))?.id;
    const bump = bumps.find((candidate) => candidate === query.get(BUMP_PARAM));
    if (component || bump) {
      setChoice({ component, bump });
      setFromQuery(true);
    }
  }, [components, bumps]);

  // The browser scrolls to a linked release (#v1.0.0-alpha.25) before the
  // query's filters hide the changes above it: back to the release, then.
  useEffect(() => {
    if (!fromQuery || !location.hash) return;
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView({ behavior: "instant" });
  }, [fromQuery]);

  const choose = (next: Choice) => {
    setChoice(next);
    const url = new URL(location.href);
    const params = { [COMPONENT_PARAM]: next.component, [BUMP_PARAM]: next.bump };
    for (const [param, value] of Object.entries(params)) {
      if (value) {
        url.searchParams.set(param, value);
      } else {
        url.searchParams.delete(param);
      }
    }
    history.replaceState(null, "", url);
  };

  return (
    <FilterContext value={{ components, bumps, facets, choice, choose }}>{children}</FilterContext>
  );
}

/**
 * The filters' buttons: all, then each component or bump with how many
 * changes it would show, given the other filter's choice.
 */
export function FilterButtons({ note }: { note?: ReactNode }) {
  const { components, bumps, facets, choice, choose } = useContext(FilterContext);
  const count = (candidate: Choice) => facets.filter((facet) => matches(facet, candidate)).length;
  return (
    <div className="flex flex-col gap-6">
      <FilterGroup legend="Component" note={note}>
        <FilterButton
          pressed={!choice.component}
          onClick={() => choose({ ...choice, component: undefined })}
        >
          All
        </FilterButton>
        {components.map(({ id, label }) => (
          <FilterButton
            key={id}
            pressed={choice.component === id}
            onClick={() => choose({ ...choice, component: id })}
          >
            {label}
            <span className="font-mono opacity-60">{count({ ...choice, component: id })}</span>
          </FilterButton>
        ))}
      </FilterGroup>
      <FilterGroup legend="Change">
        <FilterButton pressed={!choice.bump} onClick={() => choose({ ...choice, bump: undefined })}>
          All
        </FilterButton>
        {bumps.map((bump) => (
          <FilterButton
            key={bump}
            pressed={choice.bump === bump}
            onClick={() => choose({ ...choice, bump })}
          >
            {BUMP_LABELS[bump]}
            <span className="font-mono opacity-60">{count({ ...choice, bump })}</span>
          </FilterButton>
        ))}
      </FilterGroup>
    </div>
  );
}

function FilterGroup({
  legend,
  note,
  children,
}: {
  legend: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <fieldset>
      <legend className="font-mono text-text-muted text-xs leading-4">{legend}</legend>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
      {note && <p className="mt-3 text-text-muted text-xs leading-5">{note}</p>}
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

/** Its children if one of their facets matches the choice. */
export function Filtered({ facets, children }: { facets: Facet[]; children: ReactNode }) {
  const { choice } = useContext(FilterContext);
  return facets.some((facet) => matches(facet, choice)) ? children : null;
}

/** How many of a release's changes show. */
export function ChangeCount({ facets }: { facets: Facet[] }) {
  const { choice } = useContext(FilterContext);
  const noun = facets.length === 1 ? "change" : "changes";
  if (!choice.component && !choice.bump) return `${facets.length} ${noun}`;
  const shown = facets.filter((facet) => matches(facet, choice)).length;
  return `${shown} of ${facets.length} ${noun}`;
}

/** Says so when none of a release's changes match the choice. */
export function NoneFiltered({ facets }: { facets: Facet[] }) {
  const { components, choice } = useContext(FilterContext);
  if (!choice.component && !choice.bump) return null;
  if (facets.some((facet) => matches(facet, choice))) return null;
  const component = components.find(({ id }) => id === choice.component);
  const bump = choice.bump ? `${BUMP_LABELS[choice.bump].toLowerCase()} ` : "";
  return (
    <p className="text-sm text-text-muted leading-6">
      No {bump}change{component ? ` to ${component.label}` : ""} in this release.
    </p>
  );
}
