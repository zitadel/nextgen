# Console ADR 0005: Team navigation

> **Status:** Proposed
> **Date:** 2026-10-21
> **Implementation state:** §1 and §3 are implemented. §4 is open. Team detail
> (`src/routes/_authed/teams/$teamId.tsx`) has Overview and Members tabs.
> §2 is the recorded target, not built.
> **Scope:** `apps/console` only. See [`apps/console/AGENTS.md`](../../AGENTS.md).

## Context

The console has two layers of context. The **project** scopes every portal
screen: the top bar's project switcher selects it, and the sidebar lists what
can be done in it (Console ADR 0001 §4). A **team** is one level down, so
the question is whether opening a team is entering a scope or opening a
resource.

The two answers lead to different chrome:

- **Scope:** the sidebar swaps to the team's own nav and the top bar gains a
  second switcher. This is Vercel's model when you open a project.
- **Resource:** the sidebar stays on the project with Teams marked, and the
  team's sections are tabs on its detail page, as user detail's are.

Mixing them confuses people. A team switcher in the top bar with an unchanged
sidebar looks like a scope, but nothing outside the team page reads the team,
so people lose track of where they are.

Which model fits depends on what a team owns. On the API today:

| Section | API | Team's own? |
| --- | --- | --- |
| Overview (name) | `GET/PATCH/DELETE /teams/{team_id}` | yes |
| Members | `POST /users/query` filtered on `team_id` | yes, via membership |
| Access | `/grants` filtered on the team; team-scoped grants | yes |
| Login flows | `/flow_definitions` with `audience.team_ids` (app > team > project) | override, implemented |
| Branding | `/branding`, latest revision per project | no; the team audience is future work in root ADR 040 |
| IdPs | `/idps`, no audience | no |
| Operation policies | root ADR 066, Draft; the audience is #1264 | no |
| Domains | none | not modelled |

The only configuration a team can override is a login flow, and the console
has no screen for flow definitions yet.

## Decision

### 1. A team is a resource: tabs on its detail page

Team detail keeps the project's sidebar, with Teams marked, and carries its
sections as tabs: Overview (the rename), then Members (read-only, the
`team_id` filter). Access and Login flows join as tabs when they are built.
A refused member read costs the Members tab its list, not the page.

### 2. A team becomes a scope once it owns configuration

When branding or IdPs gain a team audience, or #1264 lands for policies, a
team owns enough configuration to have a nav of its own. From that point the
team is a scope, following Vercel's model:

- **Sidebar:** opening a team swaps the portal nav for the team's nav:
  Overview, Members, Access, Login flows, Branding, IdPs. Each configuration
  entry lists the project's resources and the team's overrides of them; an
  override is a resource whose `audience.team_ids` names the team.
- **Way back:** the team nav's header carries the way back to the project,
  as the Settings view's `Back to dashboard` does today.
- **Top bar:** `Project ▾ / Team ▾`, two real switchers. Switching team keeps
  the current section.
- **Route:** the team id stays in the path (`/teams/$teamId/...`), so the
  view comes from the route, as the Settings view does (`app-shell.tsx`), and
  a team URL survives a refresh.

The tabs from §1 become the team nav's first entries, so nothing built under
§1 is thrown away.

### 3. Accounts are not surfaced yet

The Settings view is the person's own space, with no section headings, and
holds one screen: **Settings**, their profile. The cloud does not use
accounts (teams in the platform project) for anything a person acts on, so
the console shows none: no account under the person's name, no list of
their teams, no account rename, and no account in search.

When accounts matter, they come back as §4 describes: an **Overview** listing
the person's accounts (`GET /users/me/teams`), each opening its settings,
and the account shown on every project.

### 4. Open: a person in more than one account

Not decided; recorded for the follow-up. An account is a team in the
platform project. The console today assumes the person has one:

- An account shown anywhere would be the first team on the person's roster
  (`GET /users/me/teams?limit=1`), which is alphabetical order, not a choice.
  That is one reason §3 shows none.
- The project switcher and search list every project the person holds a
  grant on (`GET /users/me/projects`), across all their accounts, in one
  list with no account shown.

So with two accounts, naming one account would contradict a project list
that mixes both. Making it consistent means showing the account on every project:

- **Top bar:** `Account ▾ / Project ▾ / Team ▾`. The account comes first and
  filters the project switcher and search; footer and account settings
  follow the selected account. The selection lives in the URL, like
  `?project=`.
- **Until an account is chosen:** projects grouped by account in the switcher.
  Projects with no owner sit under "No account".
- **Projects list and project settings:** an Account column or field.

It needs, first:

- **Backend:** the owning team on the project response (`owner_team_id`, with
  its name or an expand) and an `owner_team_id` filter on
  `GET /users/me/projects`. The owner is already recorded when a project is
  claimed (`GET /projects/{id}/claim/status` returns its `team_id`), but no
  project read exposes it.
- **Product decision (#333):** whether account membership grants access to
  the account's projects, or only grants do. That decides whether the
  switcher lists the account's projects or only the person's.

## Consequences

- The top bar's team switcher stands for a scope this ADR has not entered
  yet. Until §2 it is only a jump between sibling team pages, and it can
  become a breadcrumb (`Teams / Acme ▾`) or go.
- The backend work that unlocks §2 is a team audience on branding (root ADR
  040) and on IdPs, and #1264 for policies.

## Related work

- Console ADR 0001: routing and the route-driven sidebar views.
- Root ADR 024: team membership versus lifecycle ownership.
- Root ADR 040: branding revisions and the app → team → project ladder.
- Root ADR 066: operation policies, with the audience in #1264.
