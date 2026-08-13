# ADR 040: Tenant Login Templates as Editable Config

> **Status:** Proposed
> **Date:** 2026-07-20
> **Context:** How tenant-authored LiquidJS login templates ("branding") are stored, validated, delivered to the login component, and edited through the CLI. Completes the write path for the read-only `Branding` projection already defined in [`flow-api` components](../../api/openapi/components/flows/branding.yaml) and consumed by `@zitadel/components`.

## Introduction

The `<zitadel-login>` component renders each flow step through a LiquidJS
template. A default template ships inside `@zitadel/components`; the flow
response may carry a tenant-supplied override in
`branding.liquid_template`, which the component already renders through
its security pipeline ([template-security](../design/flowengine/template-security.md)).
What is missing is everything upstream of that field: there is no storage,
no write API, and no authoring workflow. This ADR defines that upstream
path as an **editable-config resource**, the same shape user schemas and
flow definitions already have: local files under `.zitadel/`, validated at
plan time, uploaded by `zitadel apply`.

## Context

- The client-side render pipeline is already hardened independently of
  what the server stores: `{{ }}` output is escaped, the `| raw` filter is
  neutered inside the engine, DOMPurify strips non-allowlisted markup, and
  `{% mandatory_gates %}` patches missing required UI at runtime. A
  malicious stored template therefore cannot escalate past chrome
  vandalism of the tenant's own login page when rendered by the official
  component.
- The server is Go; the template dialect is LiquidJS. Go Liquid parsers
  implement a different dialect, so a server-side "parse the AST on save"
  gate would validate the wrong language.
- User schemas established the immutability precedent: no update path,
  every edit publishes a new immutable revision, referrers pin revisions
  (see the schema syncer in `apps/cli/src/lib/sync/syncers.ts` and
  `internal/domain/json_schema.go`). Flow definitions are the mutable
  counter-example (PUT full replace).
- The `Branding` wire object is deliberately a **resolved projection**:
  the component receives one template string per step response and does
  not care how it was stored or selected.

## Decision

### 1. Storage: immutable per-project branding revisions

A new project-scoped resource `branding` stores the five baseline fields
(`layout`, `liquid_template`, `logo_url`, `font_url`, `hero_url`) as an
**immutable revision row**: `POST /branding` creates a revision, there is
no update or delete. This mirrors the schema model rather than the flow
model. Rationale: templates are content, not identity — an audit trail and
trivial rollback (re-apply an old revision) fall out of immutability for
free, and the absence of in-place mutation means a revision id is always a
stable reference if a future consumer wants to pin one.

Unlike schemas, nothing references branding revisions, so none of the
schema repin machinery applies. Table: `zitadel_nextgen.branding`, PK
`(project_id, id)`, payload as JSON to leave room for the structured
extensions proposed in [branding/schema.md](../design/branding/schema.md)
(palette, typography, theme) without migrations.

**Access model: managing templates and rendering them are different
planes.** The login path never calls the Branding API — templates reach
the widget inline on flow responses. The management API is therefore
uniformly strict: every operation requires a token bound to the
requested project (foreign projects answer exactly like nonexistent
ones), writes require an operator-grade scope (`project.write` |
`branding.write`) and reads `project.write` | `branding.read`. The
browser-grade preview secret (`project.read` only, shipped to visitors'
browsers by design) gets no management access at all — before this
gate, a leaked preview token could publish login templates. The
`branding.*` scope names declared in the OpenAPI contract become
mintable with [ADR 036](036-api-credential-planes.md)'s credential
planes; until then the legacy `project.write` implies them.

### 2. Resolution: latest revision, resolved per response

Every flow response (`create`, `submit`, `get step`) resolves the
**latest branding revision for the project** at response-build time and
falls back to the built-in default (`layout: centered`, no template) when
none exists. Templates are chrome, not data: a mid-flow template change
re-skins the next step but cannot reshape in-flight flow state, so live
pickup is harmless and gets fixes out immediately. This supersedes the
earlier "inherited at flow creation time" wording in the wire doc.

The wire shape is unchanged: one resolved template string per response.
Storage-side evolution (per-step template maps, app/team audience
overrides on the `app → team → project` ladder) changes only the
resolution rule, never the component contract.

**Latest-revision is the pre-releases interim, not the destination.**
[ADR 035](035-configuration-environments.md) already names branding a
release-pinned resource (its manifest example carries a
`(kind: branding, handle, revision_id)` row), and none of that machinery
exists in code yet — flow definitions resolve live by name/audience
under the same interim today. When ADR 035's deployments land, flow
responses resolve branding through the **environment's active release**:
the release pins one immutable revision id (which is why this ADR chose
revisioned-immutable storage — the id is the pinnable reference), a
`POST /branding` alone changes nothing at runtime until a release
containing it is deployed, and environments can run different branding.
Latest-revision then survives only for projects not yet under release
management. The switch touches the resolution rule alone; storage and
wire shape are already release-ready.

The inner loop must stay ceremony-free through that switch (ADR 035
leaves inner-loop semantics open; templates are the resource that
decides it). Two shapes keep iteration at zero ceremony without
puncturing the release boundary: a **local preview loop** — the CLI
already owns the full render pipeline, so `.liquid` edits can render
against fixture flow payloads with hot reload and no server round-trip —
and **release-per-save on dev-class environments** (035's
content-idempotent releases make this cheap), which preserves a single
resolution rule and means the release promoted to prod is the exact one
seen in dev.

### 3. Validation: authoritative in the CLI, lexical gate on the server

| Layer                     | Where                                                               | What                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring (authoritative) | `@zitadel/config` template validator, run by `zitadel plan`/`apply` | Real LiquidJS parse; `{% mandatory_gates %}` presence; `\| raw` usage; `<script>`/`<style>`/inline `on*=` handlers; issue list in the same shape as the flow validator |
| Save (gate)               | Go domain validator on `POST /branding`                             | Size cap, UTF-8, banned lexical patterns, https asset URLs with the canonical loopback-development exception below, layout enum                                        |
| Render (safety net)       | `@zitadel/components`                                               | Escaping, `raw` neutered, DOMPurify, CSP, `{% mandatory_gates %}`; drops loopback HTTP assets unless the embedding document is itself on loopback HTTP                 |

The TS validator is authoritative because it runs the same engine that
will render the template; the Go gate is deliberately lexical because a
faithful dialect check is impossible there and the render pipeline does
not depend on it. Caveat recorded in
[template-security](../design/flowengine/template-security.md): the API
returns raw template strings, and consumers that render outside the
official component own their own sanitisation.

**Loopback HTTP is a local-development exception for `logo_url` and
`hero_url` only.** The accepted authorities are `localhost`, canonical dotted
decimal `127.0.0.0/8`, and `[::1]`, with an optional numeric port. Shorthand,
integer, hexadecimal, expanded/mapped IPv6, leading-zero, userinfo, lookalike,
and private-network spellings are rejected consistently by the CLI, server,
component, and editor schema. Because branding revisions are project-wide, the
component preserves these HTTP URLs only when its embedding document also runs
on loopback HTTP; a public login page must never request a persisted development
asset from each visitor's device. All other asset fields remain HTTPS-only.

**`font_url` is read-only in v1.** The component must load the tenant
font stylesheet at _document_ level (shadow-scoped `@font-face` rules
never register faces — see `font-loader.ts`), so accepting an arbitrary
URL on `POST /branding` would hand `branding.write` document-level CSS
control over every page that embeds the login — precisely the boundary
the template sandbox exists to hold. The field stays on the wire shape
(the read projection and a future hierarchy still need it), but the save
gate rejects a non-empty value and the config dialect omits it. Safe
delivery options for a follow-up: the CSS Font Loading API against font
_binaries_ (registers faces without executing stylesheet CSS, at the
cost of the Google-Fonts-CSS convenience) or an origin allowlist limited
to pure font-CSS providers. Until then, tenant fonts load from the
embedding page, which already owns document-level CSS.

### 4. Local config dialect: JSON descriptor + sibling `.liquid` file

```
.zitadel/branding/branding.json   # layout, asset URLs, liquid_template_file ref
.zitadel/branding/login.liquid    # the template, edited as real Liquid
.zitadel/meta/branding.json       # config dialect meta-schema ($schema target)
```

`branding.json` references the template via `liquid_template_file`; the
CLI inlines the file content into the wire `liquid_template` on upload and
splits it back on write-back. Authors edit Liquid with syntax
highlighting, never JSON-escaped strings. The sync engine treats branding
as a third `ResourceSyncer` with schema-style semantics (`revisioned`,
edits become `revise` entries, no update/delete).

### 5. Authoring entry points: eject + design catalog

Vocabulary (canonical rows in
[`../design/glossary.md` § 6](../design/glossary.md#6-config-terms)):
**branding** is the resource, a **template** is the Liquid artifact you
edit, a **design** is a named catalog starting point that produces a
template, and **layout** is the wire degrade enum.

`zitadel branding eject [--design <name>]` scaffolds the local files from
a shipped design; `zitadel setup --design <name>` does the same during
project setup and uploads revision 1. Designs
(`centered`, `split`, `split-right`, `hero`, `minimal`) are full template files in
`@zitadel/config` defaults — the catalog documented in
[branding/templates.md](../design/branding/templates.md). The wire
`layout` enum stays `centered | split`: richer designs are delivered _as
templates_ (the escape hatch templates.md reserves), with the descriptor's
`layout` set to the nearest built-in so a template that fails component
validation degrades to something sane. Every shipped design must pass the
authoritative validator and a component-level render test.

## Consequences

- The dormant client capability (tenant template precedence over the
  bundled default) becomes reachable end to end: eject → edit → plan →
  apply → rendered.
- `@zitadel/config` becomes the single home for the template contract
  (custom tag names, validator); `@zitadel/components` imports those
  constants rather than redefining them.
- Old revisions accumulate; acceptable at template sizes, and a retention
  sweep can arrive later without API changes.
- Composes with [ADR 035](035-configuration-environments.md): an immutable
  branding revision id is exactly the kind of stable reference a
  configuration release can pin, and the v1 latest-revision resolution
  rule is what a deployed-release pointer would later replace.
- The Go gate can reject a template the TS validator would accept (or
  vice versa) only in the lexical band; divergence is bounded because the
  banned-pattern list is defined once in `@zitadel/config` and mirrored in
  the Go validator with a drift-audited test, like the flow validator
  port.

## Rejected alternatives

- **Mutable branding singleton (PUT upsert).** Simpler bookkeeping, but
  loses the audit/rollback properties and breaks the repo-wide rule that
  content resources are immutable revisions; a singleton also leaves no
  stable id for future pinning consumers.
- **Server-side Liquid AST validation in Go.** Wrong dialect; would
  reject valid templates and pass invalid ones relative to the engine
  that actually renders.
- **Pinning branding into `FlowState` at flow start.** Faithful to the
  old wire wording but bloats persisted state with template bytes (or
  reintroduces revision references the runtime doesn't need); chrome
  changes mid-flow are not a correctness hazard.
- **Custom CSS / `advanced.custom_css` as the customization surface.**
  Already rejected in [branding/schema.md](../design/branding/schema.md);
  the override ladder (tokens → inline vars → `::part()` → eject) covers
  CSS needs without a second sandboxing surface.
