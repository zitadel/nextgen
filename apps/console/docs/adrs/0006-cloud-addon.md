# Console ADR 0006: The hosted cloud's add-on

> **Status:** Proposed (the seam with five slots; the cloud's screens on mocks)
> **Date:** 2026-10-29
> **Implementation state:** §1 to §4 are implemented for the slots `Root`,
> `track`, `screens` and `signInApiBase`, the component kit and the add-on's
> Vite plugin. The cloud's Billing, Support and Email screens are scaffolded
> against `apps/cloud-functions`, whose systems are mocks (root
> [ADR 083](../../../../docs/adrs/083-hosted-cloud-business-systems.md)).
> Menu, help and banner slots are not built; the first screen that needs one
> adds it (§2).
> **Scope:** `apps/console` and `apps/cloud-console`. Amends
> [Console ADR 0004](0004-console-deployment-modes.md) §5 and its first
> consequence. See [`apps/console/AGENTS.md`](../../AGENTS.md).

## Context

The console ships twice: embedded in the Go server, the build every
self-hoster runs, and as the hosted cloud's `console` service (repo-root
[`vercel.json`](../../../../vercel.json)), which deploys `main` on every merge.
The cloud needs surfaces no self-hoster does: its analytics today, then
billing, plans, support and the account screens of a paying customer. Its UI
also moves faster than a self-hoster wants theirs to.

ADR 0004 keeps one artifact and hides what a deployment does not offer
(§5, with Billing as its example). That puts the cloud's code, and its
dependencies, into every self-hosted build, and every cloud change into the
artifact a self-hoster upgrades to. Before this ADR, Vercel's insights were
switched off by a build flag (`CONSOLE_VERCEL_INSIGHTS`), which works for one
component but not for screens.

## Decision

### 1. The cloud's build compiles in an add-on; every other build, the empty one

What only the hosted cloud needs lives in a package of its own,
[`apps/cloud-console`](../../../cloud-console/AGENTS.md)
(`@zitadel/cloud-console`). The cloud's console service builds the console
with `CONSOLE_ADDON=../cloud-console`. Every other build, the embedded one
included, compiles in `src/addon/index.ts`, which fills no slot.

### 2. The console reaches the add-on only through the contract

`src/addon/contract.ts` (`ConsoleAddon`), exported as
`@zitadel/console/addon`, lists the slots. Each is optional, so a slot costs
the builds that leave it empty nothing:

- `Root`, rendered once beside the routes on every page and told the page
  (`AddonPage`: the path and the matched route, deployment prefix included,
  and whether the signed-in layout's guard let it through);
- `track`, which receives each custom event `src/lib/analytics.ts` reports;
- `screens`, each mounted as a route beneath the signed-in layout
  (`src/addon/screens.tsx`). A screen's sidebar entry is its route's
  `staticData.nav`, as every screen's is (ADR 0001), so a build without the
  add-on has neither the screen nor the entry. Its `load` is the route's
  loader, so pending and error states are the console's own;
- `signInApiBase`, where the sign-in widget (login, sign-up, claim) sends its
  calls instead of the API base; the cloud routes them through its bot check
  (root ADR 083 §5).

A slot is added to the contract in the change whose screen needs it: entries
in the account menu or the project switcher, help, banners.

### 3. The add-on imports the contract and the kit, nothing else of the console

`@zitadel/console/addon/ui` (`src/addon/ui.ts`) exports the components an
add-on screen is built from: the settings screen's frame, its sections and
rows, and the primitives inside them. Each name in it is a promise to the
add-on; one is added when a screen needs it, never a folder. The add-on never
imports the console's source (`@/…`) or a path into its folder, so the
console stays free to change everything behind the two exports. Its typecheck
reads both from source and lists the console's `src` as an input (moon.yml,
turbo.json).

### 4. Wiring

`vite.config.ts` aliases `@/addon` to the folder `CONSOLE_ADDON` names and
dedupes React, so the add-on renders with the console's copy. Two more pieces
apply only with an add-on:

- The console's stylesheet gains an `@source` for the add-on's `src`, so
  Tailwind emits the utilities its screens use.
- The add-on's own `vite.ts`, if it has one, is loaded as a plugin. The
  cloud's inlines the settings it reads from `import.meta.env` and, under the
  dev server, proxies `/cloud/` to `apps/cloud-functions`. The console's
  config therefore names no cloud setting.

### 5. Shared screens keep ADR 0004 §5

A screen both builds show still renders from effective permissions. A
cloud-only screen is absent from the self-hosted build instead of hidden in
it.

## Consequences

- The embedded build carries no cloud code or dependency. An edit in
  `apps/cloud-console` re-runs no build the server embeds, and so no server
  build.
- Every cloud deployment misses the console's build cache through
  `VERCEL_GIT_COMMIT_SHA`, so the add-on's files need not be its inputs. A
  local build with `CONSOLE_ADDON` set and no commit can restore a stale
  one; `--force` it.
- The cloud's console build runs only on Vercel, whose preview checks report
  but do not block (root ADR 079). The add-on's typecheck is what fails a PR
  that breaks the contract or the kit.
- A change to a component in the kit can break the add-on; its typecheck
  says so in the console's PR.
- The add-on's screens mutate the generated route tree once, before the
  first router is built. Their routes are not in the router's types: links to
  them go through the sidebar, which reads routes at runtime.

## Alternatives

- **One artifact, features the server offers** (ADR 0004 §5): keeps the
  cloud's code and its churn in the self-hosted build.
- **Two apps sharing a component library**: the project screens are most of
  the console, so both apps would assemble them, with two shells, two route
  trees and every new screen wired twice. A shared screen still changes for
  both. The kit (§3) is the shared library's useful part, without a second
  app.
- **The cloud's screens in the console, their nav and routes behind a cloud
  build flag.** The shape is this ADR's: pages of their own, and an entry
  only where they exist. The cost is where the code sits:
  - file routes are always in the route tree, so the pages' chunks ship in
    the dist the server embeds, reachable by URL unless each route guards
    itself;
  - every billing or support change becomes a console change, with its
    changeset, its console lanes and its reviewers;
  - the flag is cloud knowledge in the console, which ADR 0004 §5 rules out.
- **A build flag per cloud surface** (`CONSOLE_VERCEL_INSIGHTS`): workable for
  one script, not for screens, and every flag is cloud knowledge in the
  console.
- **The router's virtual file routes** for the add-on's screens: the
  generated, committed route tree would differ between the two builds.
