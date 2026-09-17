// `Building2` returns with the parked organisation switcher below.
import { Boxes, ChevronsUpDown, type LucideIcon, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { api } from "../../api/zitadel";

/**
 * Org / project pills — Figma `Sidebar / PopoverContextSwitcher`
 * (`j3qqriDab6WQfrlgLujf4Y`). Desktop: 196px `bg-card` pills side-by-side.
 * Mobile (`Dashboard xs`): full-width stacked rows. Built on shadcn `Popover`.
 *
 * There is deliberately no create action in the footer. One used to render here,
 * but because this component backs both switchers it said "Create team" inside
 * the *project* popover too, and it carried no handler in either. `POST /teams`
 * and `POST /projects` both exist, so a create action is feasible — it needs a
 * designed flow and a per-switcher label before it comes back, not a shared
 * button that is wrong in one of the two places it appears.
 */

/**
 * What the project pill says once the read has answered with nothing. Also the
 * fallback for a failed read, so neither case leaves a skeleton behind.
 */
const NO_PROJECTS = "No projects";

interface SwitcherOption {
  id: string;
  label: string;
  plan?: string;
}

export function ContextSwitcher() {
  const projects = useProjects();
  // Display only (#1237): there is no selected-project state, so the pill shows
  // the first project the person can act on and the dropdown lists the rest as
  // labels. It does not prefer `getConsoleProjectId()`: that is the project the
  // console signs into — the platform project on a platform deployment — which
  // is never the one anybody means here. Real switching is #814's territory.
  const current = projects?.[0];

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:items-center">
      {/* The organisation switcher is parked. It was four invented orgs —
          "Acme Inc / Free", "Clearwater Labs / Pro", "Benimac LTD / Enterprise",
          "Horizons Studio / Pro" — with a hardcoded current selection and a plan
          badge naming a tier nothing sells yet. It sat at the top of every
          screen, which made the whole console look like it was scoped to a real
          organisation on a real plan.

          Organisations are teams in this model. `POST /teams/query` now lists
          them, so the dropdown could be populated — but two things it needs are
          still missing, and without them the control would look live while doing
          nothing:

            - **no current team.** Neither `GET /sessions/me` nor the runtime
              document carries one, so there is nothing to show as selected.
            - **nothing is team-scoped yet.** `POST /users/query` now accepts a
              `team_id` filter, but the console does not send one, and the
              schemas list is still project-scoped — so choosing a team would
              change nothing on screen until the users list passes it through.

          Restore this when a current team is resolvable and the list reads accept
          it. The plan badge has since been dropped from the design; if it returns,
          take it from billing (#667) rather than a literal.

          <Switcher
            icon={Box}
            label={currentTeam?.label}
            shortLabel={currentTeam?.shortLabel}
            plan={currentTeam?.plan}
            options={teams}
            ariaLabel="Switch organization"
          /> */}
      <Switcher
        icon={Boxes}
        label={current?.label}
        currentId={current?.id}
        options={projects}
        emptyLabel={NO_PROJECTS}
        ariaLabel="Switch project"
      />
    </div>
  );
}

/**
 * The projects the signed-in person can act on, from `GET /users/me/projects`
 * (root ADR 053 §6) — their own, and the ones somebody else granted them.
 *
 * Read with the session cookie, so it answers the same on the embedded console
 * as behind the dev proxy. `POST /projects/query` cannot serve this: the server
 * pins it to the calling credential's home project and accepts only a project
 * secret, which left the embedded pill a permanent skeleton.
 *
 * One page is enough: the pill shows the first project and the dropdown is a
 * reference list, not the directory — the Projects screen pages the full set.
 *
 * Loaded here rather than in the `_authed` loader so the shell paints
 * immediately and a failure degrades to an empty switcher instead of blocking
 * every screen behind it — the chrome is not worth a boundary.
 */
function useProjects(): SwitcherOption[] | undefined {
  const [projects, setProjects] = useState<SwitcherOption[] | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void api
      .listMyProjects()
      .then((result) => {
        if (cancelled) return;
        setProjects(result.projects.map((project) => ({ id: project.id, label: project.name })));
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return projects;
}

function Switcher({
  icon: Icon,
  label,
  shortLabel,
  plan,
  currentId,
  options,
  emptyLabel,
  ariaLabel,
}: {
  icon: LucideIcon;
  /** `undefined` while loading, and when there are no options to name. */
  label: string | undefined;
  shortLabel?: string;
  plan?: string;
  /** The option the pill is showing, marked `aria-current` in the list. */
  currentId?: string;
  /** `undefined` while options are loading. */
  options: SwitcherOption[] | undefined;
  /** Shown in place of a label once the options have loaded and there are none. */
  emptyLabel: string;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();

  // Loading is the options not having answered yet — not the label being
  // absent, which is also what an empty answer looks like.
  const loading = options === undefined;
  const empty = options?.length === 0;

  const rows = (options ?? []).filter((option) =>
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
          {loading ? (
            <Skeleton className="h-4 min-w-0 flex-1" />
          ) : label === undefined ? (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              {emptyLabel}
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-left font-serif text-foreground">
              <span className="md:hidden">{shortLabel ?? label}</span>
              <span className="hidden md:inline">{label}</span>
            </span>
          )}
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

        <ul id={listId} aria-label={ariaLabel} className="flex flex-col">
          {rows.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              {empty ? emptyLabel : "No results"}
            </li>
          ) : (
            // Labels, not buttons: nothing here selects anything yet. The rows
            // used to be buttons whose click only closed the popover, which
            // looked like a switch and was not one.
            rows.map((option) => (
              <li
                key={option.id}
                // By id, not by label: two projects may share a name.
                aria-current={option.id === currentId ? "true" : undefined}
                className="flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left"
              >
                <Icon size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="flex-1 truncate text-sm text-foreground">{option.label}</span>
                {option.plan && (
                  <Badge variant="secondary" className="shrink-0">
                    {option.plan}
                  </Badge>
                )}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
