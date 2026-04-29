# Documentation Restructure Plan (README-First)

## Goal

Make `docs/` easy to navigate for both humans and agents without introducing a
separate index directory that creates maintenance overhead.

## Principles

1. **README-first navigation:** Indexes live in existing `README.md` files,
   close to the docs they describe.
2. **Task-first discovery:** Readers should start from "I need to do X" paths.
3. **Clear source-of-truth split:** ADRs capture decisions, design docs capture
   evolving implementation direction.
4. **Low-overhead upkeep:** Updating documentation should require touching only
   nearby README files, not a parallel index hierarchy.

## Target Documentation Shape

```text
docs/
  README.md                   # Global task router and first entrypoint
  adrs/
    README.md                 # ADR index and decision map
    *.md                      # Architecture Decision Records
  design/
    README.md                 # Design overview and domain routing
    flowengine/
      README.md               # Domain task index
      *.md
      api/*.yaml
    cli/
      README.md               # Domain task index
      *.md
    branding/
      README.md               # Domain task index
      *.md
```

## Index Strategy (No `docs/indexes/` Folder)

### `docs/README.md` (global index)

Contains:
- "I need to..." task table mapped to start docs.
- Audience split (engineer, PM, designer, agent).
- Quick links to ADRs and design domains.

### `docs/adrs/README.md` (decision index)

Contains:
- ADR list (id, title, status, summary).
- Optional "affected domains" column for faster routing.

### `docs/design/README.md` (design hub)

Contains:
- Domain overview (`flowengine`, `cli`, `branding`).
- Current review focus per domain.
- Links to each domain README.

### `docs/design/<domain>/README.md` (local task index)

Each domain README should include:
- Scope and status.
- "Common tasks" table with "Start here" links.
- Canonical documents and related ADRs.
- Open questions and next review points when applicable.

## Document Metadata Convention

To help both humans and agents, major design docs should standardize the
existing top section with:

- Status
- Date
- Context
- What needs feedback (if draft/in review)

This should stay lightweight and human-readable (no requirement for a separate
machine-only index folder).

## Maintenance Rules

1. New doc -> add link in nearest domain `README.md`.
2. Cross-domain important doc -> also add link in `docs/README.md`.
3. New ADR -> update `docs/adrs/README.md` in the same change.
4. If a doc moves -> leave a short forwarding note in the old location until
   references are updated.

## Rollout Plan

### Phase 1: Navigation alignment (no content moves)
- Create/refresh `docs/README.md` as task-first entrypoint.
- Expand `docs/design/README.md` with domain routing.
- Normalize task tables in domain READMEs.
- Expand ADR index table in `docs/adrs/README.md`.

### Phase 2: Consistency pass
- Normalize status/context sections across major design docs.
- Ensure cross-links between design docs and related ADRs are explicit.
- Remove dead or duplicate links.

### Phase 3: Optional structural moves (only if still needed)
- Move files only where discoverability materially improves.
- Keep short compatibility forwarding notes at old paths during transition.

## Definition of Done

- A contributor can reach relevant docs in <= 3 clicks from `docs/README.md`.
- Every design domain has a task-oriented `README.md`.
- ADR index is current and usable as a decision map.
- No dedicated `docs/indexes/` folder is required.
