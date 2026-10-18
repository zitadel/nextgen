# ADR 043: Framework Version Floors

> **Status:** Accepted
> **Date:** 2026-08-02
> **Context:** The `zitadel` CLI's framework detectors, `setup`/`doctor`, and the `@zitadel/sdk-next` peer range.
> **Relates to:** [ADR 042](042-scaffolded-file-ownership-and-drift-detection.md)

## Context

The CLI's scaffolded templates make version-specific assumptions that the
declared support ranges did not: `@zitadel/sdk-next` claimed `next >=14` /
`react >=18` while the Next templates target current App Router conventions
(the `middleware.ts`/`proxy.ts` boundary handling starts at 15, and React
binds non-primitive custom-element props as properties only from 19 — the
business copy overlay had to move to a ref assignment to stay correct on 18).
Nothing enforced any floor: the detectors record `versionMajor` without
judging it, so a Next 14 or React 17 app scaffolded "successfully" into a
subtly or visibly broken integration.

Two review rounds probed this gap independently (Next 15 boundary handling on
the ADR 042 work; React 18 `locales` decay on the use-case templates), and
each time the answer was the same principle: a support floor must be an
explicit, loud error — never a silent narrowing hidden in template behavior.
This ADR records the floors and the enforcement point.

## Decision

- **Floors:** every framework the CLI detects declares one, as a plain
  semver string: Next.js **15.2.3**, React **18**, Vue **3**, Nuxt **4**,
  Angular **17** (`@angular/core`), Solid **1.6** (`solid-js`), Svelte **5**
  and Qwik **2.0.0-beta.45** (`@qwik.dev/core`, the first release the SDK's peer
  range accepts, so the floor is a prerelease and is the bound as written). Both 18 and 19 are supported for React;
  templates that need React-19-only behavior must degrade safely on 18, as the
  ref-assigned copy overlay does. The Next floor is a patch release, not the
  major: 15.0.0 to 15.2.2 skip middleware for a request that sends
  `x-middleware-subrequest` (CVE-2025-29927), which bypasses the generated
  `protectedRoutes`. Svelte 5 is required because `@zitadel/sdk-svelte` is
  written with runes, so a Svelte 4 app can neither install nor compile it.
- **Each detector declares its floor; one function enforces it.** The
  `Detector` interface carries `versionPackage` (the npm package the version is
  read from) and `versionFloor` (the minimum, with an optional
  `versionFloorNote` appended to the upgrade hint). Every detector calls
  `enforceVersionFloor` (`apps/cli/src/lib/orca/detectors/version-floor.ts`)
  from `detect` once it recognises the project; no detector carries its own
  checking logic and there is no separate floor table. A detected framework
  below its floor throws `E_UNSUPPORTED_PROJECT_SHAPE` (exit 3) with the floor in
  the message and an upgrade hint. Detection is the shared gate, so `setup`
  refuses before any mutation and `doctor`'s framework check fails with the
  same message on an app that was scaffolded earlier and later downgraded (or
  scaffolded before the floor existed). The existing error code is reused
  deliberately: a below-floor version is the same family as "Pages Router not
  supported", and agents already branch on it.
- **Only provable violations reject.** The gate evaluates the declared spec
  with semver range semantics: it rejects only when the range cannot resolve
  to the floor or newer (`^14.2.0`, `<15` and `15.2.2` reject for Next; `>=14`,
  `14 || 16` and `^15.0.0` pass because a supported version satisfies them).
  Every framework is also judged by what is installed: when
  `node_modules/<package>/package.json` resolves from the app root, a release
  below the floor rejects even under an accepting range, because the lockfile
  may still hold one. With nothing installed, the spec is the only gate. Specs
  that carry no provable version at all, protocol specs (`file:`, `link:`,
  `workspace:`, git URLs) and dist-tags (`latest`, `canary`), always pass;
  blocking on them would be hostile guessing. A prerelease of a
  floor that names only a major or minor line (React 18, Solid 1.6) counts as
  at-floor, but a prerelease of an exact release floor (`15.2.3-canary.0`)
  predates it and is below. The installed lookup walks up from the app through
  each `node_modules` and stops after the workspace root, and the refusal names
  the `package.json` it read. There is no ceiling: a newer major is never refused here.
- **Peer ranges follow the floor, and a test keeps them aligned.** Each SDK
  package's peer range for the framework starts at the same major as the
  detector's floor (`next >=15`, `nuxt >=4`, `react >=18`, `vue >=3`,
  `@angular/core >=17`, `solid-js >=1.6`, `svelte ^5.0.0`,
  `@qwik.dev/core ^2.0.0-beta.45`). The registry's mirror test reads each
  `packages/sdk-<framework>/package.json` and fails if the floor's major differs
  from the peer minimum's, or the floor does not satisfy the peer range (Next's
  patch floor may sit above the peer minimum). The gate checks the floor only,
  not the SDK's upper bound; widening the SDK peer is how a newer major gets
  supported. Raising a floor means changing the detector's `versionFloor` and the
  SDK peer together, and amending this ADR.

## Consequences

- A Next 14 or React 17 (Vite) app gets one clear refusal at `setup` time
  with an upgrade path, instead of a scaffold whose behavior quietly varies
  by version.
- `doctor` tells the truth about downgraded or pre-floor projects: the
  framework check fails with the floor message; per ADR 042's degradation
  rules the managed-files check falls back to a warning rather than piling
  on or crashing.
- Raising a floor (e.g. requiring React 19) is a product decision expressed
  as a one-line detector change plus an ADR amendment — the mechanism makes
  the silent-narrowing failure mode structurally unavailable.
