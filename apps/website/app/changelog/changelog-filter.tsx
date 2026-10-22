"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type Choice, type Component, type Facet, KIND_LABELS, type Kind, matches } from "./filter";

type Filter = {
  components: Component[];
  kinds: Kind[];
  /** Every change on the page, for the buttons' counts. */
  facets: Facet[];
  choice: Choice;
  choose: (choice: Choice) => void;
};

const FilterContext = createContext<Filter>({
  components: [],
  kinds: [],
  facets: [],
  choice: {},
  choose: () => {},
});

// The query that holds the choice, so a filtered page can be shared:
// /changelog?component=cli&change=breaking.
const COMPONENT_PARAM = "component";
const KIND_PARAM = "change";

/**
 * The changelog's filters, by component and by kind. The page is static and
 * holds every change; once it runs, the filters hide what does not match the
 * choice. The choice comes from the query and goes back into it.
 */
export function ChangelogFilter({
  components,
  kinds,
  facets,
  children,
}: Omit<Filter, "choice" | "choose"> & { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>({});
  const [fromQuery, setFromQuery] = useState(false);

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const component = components.find(({ id }) => id === query.get(COMPONENT_PARAM))?.id;
    const kind = kinds.find((candidate) => candidate === query.get(KIND_PARAM));
    if (component || kind) {
      setChoice({ component, kind });
      setFromQuery(true);
    }
  }, [components, kinds]);

  // The browser scrolls to a linked release (#v0.1.0) before the query's
  // filters hide the changes above it: back to the release, then.
  useEffect(() => {
    if (!fromQuery || !location.hash) return;
    document
      .getElementById(decodeURIComponent(location.hash.slice(1)))
      ?.scrollIntoView({ behavior: "instant" });
  }, [fromQuery]);

  const choose = (next: Choice) => {
    setChoice(next);
    const url = new URL(location.href);
    const params = { [COMPONENT_PARAM]: next.component, [KIND_PARAM]: next.kind };
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
    <FilterContext value={{ components, kinds, facets, choice, choose }}>{children}</FilterContext>
  );
}

/**
 * The filters' buttons: all, then each component or kind with how many
 * changes it would show, given the other filter's choice.
 */
export function FilterButtons({ note }: { note?: ReactNode }) {
  const { components, kinds, facets, choice, choose } = useContext(FilterContext);
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
        <FilterButton pressed={!choice.kind} onClick={() => choose({ ...choice, kind: undefined })}>
          All
        </FilterButton>
        {kinds.map((kind) => (
          <FilterButton
            key={kind}
            pressed={choice.kind === kind}
            onClick={() => choose({ ...choice, kind })}
          >
            {KIND_LABELS[kind]}
            <span className="font-mono opacity-60">{count({ ...choice, kind })}</span>
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
  if (!choice.component && !choice.kind) return `${facets.length} ${noun}`;
  const shown = facets.filter((facet) => matches(facet, choice)).length;
  return `${shown} of ${facets.length} ${noun}`;
}

/** Says so when none of a release's changes match the choice. */
export function NoneFiltered({ facets }: { facets: Facet[] }) {
  const { components, choice } = useContext(FilterContext);
  if (!choice.component && !choice.kind) return null;
  if (facets.some((facet) => matches(facet, choice))) return null;
  const component = components.find(({ id }) => id === choice.component);
  const kind = choice.kind ? `${KIND_LABELS[choice.kind].toLowerCase()} ` : "";
  return (
    <p className="text-sm text-text-muted leading-6">
      No {kind}change{component ? ` to ${component.label}` : ""} in this release.
    </p>
  );
}
