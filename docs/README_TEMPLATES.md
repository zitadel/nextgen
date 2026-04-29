# Documentation README Templates

Copy and adapt these templates when creating or refreshing documentation
entrypoints. They implement the README-first navigation model from
[`docs/PLAN.md`](./PLAN.md).

## Root Template (`docs/README.md`)

```md
# Documentation

This folder contains product decisions and design direction for nextgen.

## Start by Task

Use this table when you know what you need to do, but not where to start.

| I need to... | Start here | Then read |
|---|---|---|
| Understand architecture decisions | [ADRs](./adrs/README.md) | Relevant ADR file(s) |
| Change authentication and flow behavior | [Authentication design](./design/flowengine/README.md) | Flow Engine + Session API docs |
| Change CLI behavior or resource model | [CLI design](./design/cli/README.md) | Identity surface + plan docs |
| Change login UI branding/templates | [Branding design](./design/branding/README.md) | Tokens + templates + validator |
| Find active design discussions | [Design hub](./design/README.md) | Domain README "Open questions" sections |

## Read by Audience

- **Engineers:** start with [Design hub](./design/README.md), then domain README.
- **Product/Architecture:** start with [ADRs](./adrs/README.md), then design
  domain context.
- **Agents:** start with the relevant task row above, follow domain README
  "Common tasks" and "Canonical docs" sections.

## Documentation Map

- [Architecture Decision Records](./adrs/README.md)
- [Design Hub](./design/README.md)
  - [Flow Engine](./design/flowengine/README.md)
  - [CLI](./design/cli/README.md)
  - [Branding](./design/branding/README.md)

## Conventions

- ADRs are decision records and source-of-truth for accepted architecture.
- Design docs may be draft/in-review and should state status at the top.
- New docs must be linked from the nearest domain README in the same change.
```

## Domain Template (`docs/design/<domain>/README.md`)

```md
# <Domain Name>

> **Status:** Draft | In Review | Accepted
> **Date:** YYYY-MM-DD
> **Context:** One-sentence scope for this domain.

## Scope

Describe what this domain owns and what is out of scope.

## Common Tasks

Use this table for task-first routing inside the domain.

| Task | Start here | Related docs | Related ADRs |
|---|---|---|---|
| <Task 1> | [<doc>](./<doc>.md) | [<doc>](./<doc>.md) | [ADR NNN](../../adrs/NNN-<slug>.md) |
| <Task 2> | [<doc>](./<doc>.md) | [<doc>](./<doc>.md) | [ADR NNN](../../adrs/NNN-<slug>.md) |
| <Task 3> | [<doc>](./<doc>.md) | [<doc>](./<doc>.md) | [ADR NNN](../../adrs/NNN-<slug>.md) |

## Canonical Documents

List the core docs in this domain and what each one answers.

| Document | Status | Purpose |
|---|---|---|
| [<doc>](./<doc>.md) | Draft | <What this explains> |
| [<doc>](./<doc>.md) | In Review | <What this explains> |

## Related Decisions (ADRs)

- [ADR NNN: <title>](../../adrs/NNN-<slug>.md)
- [ADR NNN: <title>](../../adrs/NNN-<slug>.md)

## Open Questions / Review Focus

- <Question or unresolved tradeoff>
- <Question or unresolved tradeoff>

## Change Checklist

- [ ] New/updated docs are linked in this README.
- [ ] Cross-domain docs are linked from `docs/README.md`.
- [ ] ADR references are up to date.
- [ ] Stale links removed.
```
