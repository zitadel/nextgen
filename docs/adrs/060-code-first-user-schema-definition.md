# ADR 060: Code-First User Schema Definition

> **Status:** Proposed
> **Date:** 2026-08-27
> **Context:** User schema authoring, config push, developer and agent DX
>
> **Builds on** [ADR 008](008-users-eav-store.md), [ADR 009](009-user-json-schema-validation.md),
> [ADR 020](020-credentials-out-of-user-schema.md), [ADR 035](035-configuration-environments.md),
> [ADR 036](036-api-credential-planes.md), [ADR 052](052-user-envelope-and-attributes.md),
> [ADR 058](058-user-identity-designation-and-references.md).
> Keeps [ADR 007](007-gitops-configuration-surface.md)'s premise — the repo
> declares configuration — while changing the authoring format. Resolves
> ADR 035's open inner-loop question as Vercel-shaped for the development
> environment only.

## Context

Today a developer hand-authors `.zitadel/schemas/*.json` in the JSON Schema
dialect, keeps the flow definition's `fields[]` in sync by hand, and publishes
through the CLI. Mismatches surface only at deploy time
(`validateRequiredUserSchemaFields`), and the app gets no typed access to its
own user attributes (`UserAttributes` is an open map end to end).

The schema file's information content is small — properties and types,
`required`, `x-unique`, `x-auth-methods` — and fully expressible in a typed
definition inside the developer's own code.

## Decision

The authoring surface for user schemas becomes a **typed definition in the app
repository**. JSON Schema becomes its compile target, not its editing surface.

1. **One definition, in code.** `defineUser({ … })` is a runtime-introspectable
   definition (builder / Standard Schema object — not a bare TS type, not an
   example object) declaring properties, required, uniqueness scope, auth
   methods, and identity designation (`x-identifier` / `x-display`, ADR 058).
   It compiles deterministically to today's user-schema dialect. The
   server model is unchanged: immutable revisions keyed by `objectType`, EAV
   validation, releases per ADR 035.
2. **Both sides generate from it.** The register step's `fields[]` and the
   schema come from the same definition; flow↔schema consistency moves from
   deploy-time rejection to typecheck time. Step grouping stays in the flow
   definition (dialect unchanged), but its field references are typechecked.
   Typed `attributes` flow through the SDK, session, and testkit seeding.
3. **Dev loop: ambient push.** A dev-server hook compiles and pushes on change
   to the development environment (draft, release, deployment in one step).
   ADR 035's content-hash idempotency makes unchanged pushes no-ops. No
   `plan`/`apply` ceremony in the inner loop.
4. **Prod: explicit release.** CI compiles the same definition and calls
   `POST /configuration-releases`; git stays the review surface. The running
   app never pushes config — no ambient upload on SDK boot, ever.
5. **Auth is operator-plane.** Dev pushes read `.zitadel/secret` from disk,
   never the app's env (ADR 036 is removing that coupling). CI pushes use an
   **environment-scoped deploy token** — the first step of ADR 036's operator
   divergence; it makes release `created_by` meaningful (ADR 046: a bare
   bearer is not an identity) and caps blast radius. Token design follows in a
   credential ADR.
6. **Never inferred from runtime traffic.** Registration calls are untrusted
   input; the definition reaches the server only through the config plane.
   JSON Schema stays a first-class ingestion format for non-TS stacks, agents,
   and console edits (`zitadel pull` round-trips).

## Consequences

- The two-file sync between `.zitadel/schemas/` and `.zitadel/flows/` field
  lists dissolves; a class of deploy-time errors becomes compile-time.
- Agents edit one typed definition with compiler feedback instead of a JSON
  dialect plus CLI ceremony; the `SKILLS.md` surface shrinks.
- The testkit provisions instances from the same definition
  (`bootstrapProject` already pushes schema and flow over plain HTTP), closing
  the gap where customized projects e2e-test against default config.
- Schema evolution gains guardrails it lacks today: the push classifies diffs.
  Additive changes flow; breaking ones (rename, remove, newly-required,
  uniqueness change) halt for explicit confirmation, because ADR 009 forbids
  auto-migration and stranding existing users must not be a refactor keystroke.
- New server-side work: the diff classifier, and an `objectType` handle guard
  (uniqueness and rename protection), which does not exist today.

## Out of scope

- Runtime-plane credentials (session-scoped SDK writes, per-app credentials) —
  same intent-vs-record boundary, separate ADR.
- The definition API's concrete shape (own builder vs Standard Schema interop).
- Multi-app ownership conflicts beyond content-hash idempotency.
- Deprecating hand-authored `.zitadel/schemas/` files; they remain valid input.

## Open questions

- ADR 052's unresolved `schema` pointer (URL vs `sch_` id) is forced here: the
  compiled artifact must reference its revision deterministically.
- Where the breaking-change confirmation lives in a CLI-less loop (dev-server
  prompt vs CI gate output).
