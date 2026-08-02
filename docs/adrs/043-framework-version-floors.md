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

- **Floors:** Next.js **15+** (App Router, as before) and React **18+** (both
  18 and 19 are supported; templates that need React-19-only behavior must
  degrade safely on 18, as the ref-assigned copy overlay does).
- **Enforcement lives in the framework detectors** (`NextDetector`,
  `ReactDetector`): a detected framework below its floor throws
  `E_UNSUPPORTED_PROJECT_SHAPE` (exit 3) with the floor in the message and an
  upgrade hint. Detection is the shared gate, so `setup` refuses before any
  mutation and `doctor`'s framework check fails with the same message on an
  app that was scaffolded earlier and later downgraded (or scaffolded before
  the floor existed). The existing error code is reused deliberately: a
  below-floor version is the same family as "Pages Router not supported",
  and agents already branch on it.
- **Only provable violations reject.** The gate evaluates the declared spec
  with semver range semantics: it rejects only when the range cannot resolve
  to the floor major or newer (`^14.2.0` and `<15` reject; `>=14` and
  `14 || 16` pass because a supported version satisfies them). Specs that
  carry no provable version at all — protocol specs (`file:`, `link:`,
  `workspace:`, git URLs) and dist-tags (`latest`, `canary`) — always pass;
  blocking on them would be hostile guessing. Prereleases of the floor major
  count as at-floor.
- **Peer ranges follow the floor:** `@zitadel/sdk-next` declares `next >=15`
  (its `react >=18` was already correct). Other frameworks currently declare
  no floor; adding one later means extending its detector the same way and
  amending this ADR.

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
