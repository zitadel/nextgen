# Console Read-Only Views

> **Status:** Planning notes
>
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851), "Enable social login with Google and GitHub"
>
> **Area:** 7 of 9 (see [`README.md`](README.md))

The Console's share of the epic is two read views: the authentication methods each user schema declares, and the IdP connections that exist for the Project. Nothing here is writable. Configuration changes stay in the CLI journeys (areas 4 and 5); the Console shows what those journeys produced.

## Imported Requirements

No row of area 1's [exported table](1-resource-model.md#exported-requirements) is owed by this area. The console-relevant rows there (the read API, a lineage identity) are owed by the CRUD API, and this document adds read requirements to that same work item. What this area answers is the epic's three Console acceptance criteria:

- [x] "The Console shows the authentication methods defined by the latest version of each user schema." Answered in [Auth Methods Per Schema](#auth-methods-per-schema); "latest" is deliberately read as the revision active flows pin, the closest derivable signal (boundaries recorded in [The Latest-Version Gap](#the-latest-version-gap)).
- [x] "The Console shows which Google and GitHub connections exist for the Project." Answered in [Existing Connections](#existing-connections).
- [x] "Authentication methods and provider connections cannot be changed through the Console in this iteration." Answered in [Read-Only Scope](#read-only-scope).

Premises imported from sibling areas:

- **Area 1:** connections are identified by `slug`, and stored bodies hold env var names, never values: "Secret resolution must never happen upstream of anything that is diffed, hashed, committed, or printed." A stored document is therefore safe to render whole.
- **Area 2:** the `sso` slot's `providers` list is this area's data source, and was shaped partly for it: "Both the post-claim journey and the Console need to display exactly which authentication methods a schema supports."
- **Area 4:** the scope boundary: the developer explicitly cannot "configure or manage identity provider connections through the Console in this iteration".

## What Exists Today

The schema half is mostly built; the connection half does not exist at any layer.

| Surface | State |
| :--- | :--- |
| Schemas list ([`apps/console/src/routes/_authed/schemas/index.tsx`](../../../apps/console/src/routes/_authed/schemas/index.tsx)) | `Card` of rows; each row reads its fetched document: display name, attribute chips, and a sign-in summary ("Passkey + Password") from `x-auth-methods`. |
| Schema detail (`$schemaId.tsx`) | Fields tab plus an Authentication tab listing every declared method with an Enabled/Disabled badge. |
| Method reader ([`apps/console/src/lib/schema.ts`](../../../apps/console/src/lib/schema.ts), `schemaAuthMethods`) | Returns `{key, label, enabled}` per declared method. `sso` renders as the generic label "SSO"; `providers` is not read. |
| Login flows (`_authed/flow-definitions/`) | Pre-design-refresh list and raw JSON detail, currently without a sidebar entry. The detail response carries the full flow document, including its `user_schema` pin. |
| Connections | Nothing. No screen, no endpoint group under `api/openapi/endpoints/`, no generated client surface. The CRUD API is area 1's largest open point. |

Platform reads available to the console: `listSchemas` returns `{id, created_at}` rows (`internal/api/schema.go:95`), `getSchemaById` returns the stored document, `listFlowDefinitions` returns metadata rows, and `getFlowDefinition` returns the document. The schemas loader already fetches each listed document to fill its row, on the argument that configuration lists stay small (`index.tsx:29`).

## Read-Only Scope

The console builds no write affordances for either resource: no create, edit, or delete controls, and no row action beyond viewing. That is the posture the schema screens already take, and it is how the epic's "cannot be changed" criterion is enforced in this iteration. It is a surface decision, not a permission system: console management reads ride the same authorization as every other screen (console ADR 0003 records that management authorization stays on the server-held project secret until session-derived permissions exist).

Also out of scope:

- **Deployment state.** The epic: "The relationship between local CLI changes and the configuration shown in the Console should be handled separately if Zitadel introduces deployment-state tracking." The console shows what the platform stores and claims nothing about any working tree.
- **Connection revision history.** The list serves current revisions only; superseded revisions stay stored but have no screen.
- **Environments.** Single-environment reads until #534 exists.

## Auth Methods Per Schema

Two gaps separate today's screens from the epic's criterion: the reader ignores `sso.providers`, and "latest version" is not derivable from the schema list alone.

### Rendering `sso.providers`

`schemaAuthMethods` gains provider awareness: for the `sso` key it also returns the `providers` slugs (area 2's `sso-auth-method.json`). The screens render:

- **List row summary:** provider names replace the generic "SSO" token, so the line reads "Passkey + Google" rather than "Passkey + SSO". Other methods keep their labels. The summary keeps the reader's alphabetical key order; within the expansion, providers follow authored order, the same order the tab uses.
- **Authentication tab:** the SSO row lists its providers beneath it, one entry per slug, in authored order. A disabled `sso` entry that retains its list (area 2's off-switch state) renders Disabled with its providers dimmed, not hidden.

```jsonc
// Customers schema as the console reads it
"x-auth-methods": {
  "passkey": { "enabled": true },
  "sso": { "enabled": true, "providers": ["google", "github"] }
}
```

Labels: a slug is tenant-authored (`corp_idp`), so the console never prettifies it. Once the [connections list](#the-read-contract) exists, the screens join slug to `display_name` ("Google") and Authentication-tab entries link to their connection at `/idps/$slug`; until then, and for any slug without a matching connection, the slug renders verbatim, as text rather than a dead link. That is the same defensive fallback the reader already applies to unknown method keys. Vendor glyphs come from the shared icon set: area 3 exports adding provider glyphs to `zl-icon`, and the console consumes those through the existing pair packages rather than introducing its own brand-icon source.

The console renders capability, not usage. Whether a flow actually offers a listed provider is the validator's cross-resource question: area 2's dead-capability warning exists precisely because "The Console would advertise a sign-in method that has no actual login path." The console does not re-validate; it shows the schema as stored, and relies on the plan-time warning to keep that state rare.

### The Latest-Version Gap

Schema edits publish new immutable documents. The mechanics: the syncer only ever creates (a hash change publishes a new revision through `create`, `apps/cli/src/lib/sync/syncers.ts:129`), platform deletion is not supported (`syncers.ts:145`), and a document's identity is its URL (`$id` if authored, `internal/domain/json_schema.go:73`; otherwise a `sch_*` id minted dialect-side, `internal/storage/dialect/sqlite/json_schema.go:30`), unique per project (`internal/service/schema_service.go:68`). Revisions of one lineage therefore cannot share an identity, and the `previousId` chain that links them lives only in the local `state.json`. The by-id contract even says "This will return the default revision of the schema." (`api/openapi/endpoints/schemas/by_id/methods.yaml:4`); no revision concept exists behind that sentence.

So `listSchemas` accumulates one row per published revision, and nothing in the response distinguishes the current revision of a lineage from its superseded siblings. After a few "Sign-in methods" edits (area 5), the list shows several same-named rows with different method sets, and the epic's "latest version" criterion fails without a discriminator.

What the platform does know is which schema documents the login configuration uses right now: every flow definition pins one (`user_schema`, `api/openapi/components/flows/flow-definition.yaml:26`), and the sync loop re-pins every referencing flow whenever it publishes a schema revision (`apps/cli/src/lib/sync/loop.ts:44`). The pinned set therefore tracks the newest applied revision of every lineage the login journey touches.

**Decision:** the schemas list derives an **In use** marker from flow pins and sorts newest-first.

- The loader also fetches the flow definitions and collects the distinct `user_schema` values of **active** flows (list plus documents; both lists are small for the same reason the schema list is). The list rows already carry `status`, so the filter is free and skips fetching draft documents.
- Draft flows are excluded: the engine does not select drafts for new sign-ins (`api/openapi/components/flows/flow-definition-status.yaml`), and draft is both settable at creation and reachable by demoting an active flow. A draft's pin says nothing about the running configuration, and a stale draft would otherwise keep a superseded revision badged.
- A schema row whose id is pinned carries an "In use" badge; unpinned rows render dimmed. Within a lineage, the pinned row is the latest applied revision. Absent a lineage discriminator in the API, this pin is the closest derivable reading of the criterion's "latest" (boundaries below).
- The list sorts by `created_at` descending, so a lineage's newest revision also sits above its superseded siblings.

Boundaries, recorded rather than solved:

- A schema no flow references (created but never wired into a login journey) renders unpinned. In 851's scaffolded journeys every schema is pinned after apply, so this state is reachable only outside the epic's path.
- Mid-apply, or after an interrupted apply, two revisions of one lineage can both be pinned until the next run's recovery re-pin. Two "In use" rows is the honest rendering of that state.
- "In use" is an active-flow fact, not a lineage fact. The console can say "no active flow uses this"; it cannot say "superseded".

Rejected alternatives:

- **Group rows by `title`.** Renames split a lineage, and two schemas may share a title. Grouping on customer-authored text invents a lineage the platform does not have.
- **Platform lineage now.** A `supersedes` field on `POST /schemas` would be cheap to record (the CLI knows `previousId` at publish time) and impossible to reconstruct later, but it is new write surface on the schemas contract, it has fork and multi-workspace edge cases, and the criterion is satisfiable without server changes. It belongs with the deployment-state work the epic defers.
- **Hide unpinned rows.** A developer looking for an old revision's id would find a list that denies the revision exists. Dimming keeps the data visible.

When ADR 035's release model ships, "current configuration" becomes a real platform object: a release pins an exact revision of every resource, and area 1 already exports slug-to-revision recording to the bundle constructor (#529). The pin derivation then swaps for reading the promoted release. Exported below.

## Existing Connections

### The Read Contract

No IdP API exists, so this area states what the console needs from area 1's CRUD API rather than consuming a contract. That surface is now designed in [`9-crud-api.md`](9-crud-api.md), with these needs as imported requirements. Area 1's exported table already demands that "The API surface must support `get-by-slug` and strictly enforce uniqueness on creation."; the console adds the read pair:

- **List (project-scoped): one row per `slug`, serving the newest revision.** Connections have what schemas lack: a stable, project-unique lineage identity. One row per slug is exactly "which connections exist"; no client-side revision handling. Superseded revisions stay stored (area 1's immutability) but do not appear. Rows sort by `slug` ascending: stable across edits, where the served revision's `created_at` would reorder the list on every publish.
- **Rows carry the display fields inline:** `id` (the lineage identity), `revision_id` (the served revision), `slug`, `display_name`, `protocol`, `template`, `created_at`. The schemas list has to fetch every document because its rows are `{id, created_at}`; the connections list should not repeat that shape.
- **Get-by-slug returns the served revision's stored document** plus the row metadata. Bodies are value-free by construction (area 1's secret invariant), so the console renders the document without a redaction pass. The construction holds because the server validates bodies at create and revise (area 1's exported requirements); client-side validation alone would not cover hand-authored API writes. `client_secret_env` is a variable name and is deliberately visible: which env var feeds a connection is exactly what a developer checks before rotating a secret.
- **A read scope following the existing naming**, alongside `schema.read` and `flow_definition.read` (`api/openapi/security/oauth2.yaml:10`). Spelling settled with the CRUD API: `idp.read` ([`9-crud-api.md`](9-crud-api.md)).

```jsonc
// GET /idps?project_id=… - one row per slug, newest revision
{
  "idps": [
    { "id": "idp_01KWJ1M2N3P4Q5R6S7T8V9WXYZ", "revision_id": "idprev_01KWJ1M4XCZQ8G2H7T5V0R9WYE", "slug": "github", "display_name": "GitHub", "protocol": "oauth2", "template": "github", "created_at": "2026-08-15T11:02:00Z" },
    { "id": "idp_01KWJ0Q8ZV3TCMVQH0F7DQRB2E", "revision_id": "idprev_01KWJ0Q9AEB7N4S1D8F2K6M3PX", "slug": "google", "display_name": "Google", "protocol": "oidc", "template": "google", "created_at": "2026-08-14T09:30:00Z" }
  ],
  "next_page_token": null
}
```

The sketch mirrors the flow list's pagination shape; `id` is the lineage identity and `revision_id` the served revision, the two id spaces area 9 registers ([`9-crud-api.md`](9-crud-api.md); ADR 047 owns minting). `created_at` is the served revision's creation time, which for an edited connection reads as "last updated". A lineage-level "first created" now exists on the lineage row and rides the get envelope ([`9-crud-api.md`](9-crud-api.md)); the list keeps the compact display shape.

### The Screen

- **Route `/idps`, nested in the sidebar under Users beside User schemas, labeled "Identity providers".** The grouping mirrors the epic's framing: providers answer "how should these users sign in?", and the two screens cross-reference each other. The sidebar rule stands: the entry appears when the endpoint exists, never as a disabled row (`apps/console/src/nav.ts:44`).
- **List:** the schemas-list pattern (a `Card` of rows; the D0a/D7 reasoning applies unchanged: a configuration list, small, not a dense table). Each row: vendor glyph resolved from `template` with a generic fallback, `display_name`, the slug as a chip, protocol, date, and a row menu with **View** only. No status column: the list returns active connections only, deletion tombstones never appear in it ([`9-crud-api.md`](9-crud-api.md#deletion-and-slug-reservation)). (`enabled` was deliberately cut in area 1; the wire's `status` field serves tombstone reads, not the list.)
- **Detail `/idps/$slug`:** the schema-detail pattern. The route keys on the slug, not the served revision's id: an id changes on every edit, while the slug is the stable identity everything else references, so bookmarked URLs survive edits and always show the current revision. (The schema screens key on id only because schemas lack a lineage identity.) Header lockup (glyph, "Identity provider" eyebrow, display name), a metadata strip (slug, protocol, template, `client_id`, secret env name, date), and the stored document in the same read-only viewer the schema detail uses.
- **Empty state** points at the only setup surface: "No identity providers yet. Set them up from the CLI: `npx zitadel` → Sign-in methods." (area 5's vocabulary).
- **Vendors stay data here too.** The screen renders whatever connections exist and enumerates no vendor anywhere. 851 tenants will see Google and GitHub because that is what the journeys scaffold.
- **No Figma frame exists** for either surface; the design's sidebar has no identity-provider entry. Both screens compose existing console patterns (console-only chrome on the shadcn utility contract, per `apps/console/docs/styling.md`; no new Lit+React pair), and the visual pass is an open point.

## Sequencing

Three deliverables, independently shippable, in dependency order:

1. **Provider-aware method rendering** (`schemaAuthMethods` plus the two schema screens). Needs only area 2's schema shape; documents without `providers` render exactly as today. Slug labels until step 3.
2. **In-use badge and newest-first sort** (schemas list). Needs no new platform surface.
3. **Connections screens.** Gated on the CRUD API read pair; the display-name join in the schema screens arrives with it.

Tests follow the shipped layers: route specs with MSW fixtures (the `schemas.spec.tsx` pattern) for all three, and the console-e2e real-instance lane for the connections screen once the server serves the API. The receipt suite ([`packages/config/src/idp-design-docs.test.ts`](../../../packages/config/src/idp-design-docs.test.ts)) pins this document's examples and cross-doc quotes.

## Exported Requirements

| Requirement | Owed by |
| :--- | :--- |
| Slug-keyed connections list: project-scoped, one row per slug serving the newest revision, rows carrying `slug`, `display_name`, `protocol`, `template`, `created_at` inline. | Server CRUD API ([`9-crud-api.md`](9-crud-api.md)) |
| Get-by-slug read returning the served revision's stored, value-free document with row metadata. | Server CRUD API ([`9-crud-api.md`](9-crud-api.md)) |
| A connection read scope following the existing `<resource>.read` naming. | Server CRUD API (`idp.read`, [`9-crud-api.md`](9-crud-api.md)) |
| "Current configuration" reads (the in-use derivation, any future drift view) swap to the promoted release's pin set once the release model ships. | ADR 035 / #542 release work |

## Open Points

- **Design pass.** No Figma frames exist; nav placement (nested under Users vs top level) and both screens' visuals need design review.
- **Glyph consumption.** Area 3 adds provider glyphs to `zl-icon`; confirm the console reaches them through `@zitadel/ui-react` rather than a parallel icon set.
- **Detail-screen depth.** Whether to render `claim_mapping` and `verified_claims` as tables, and whether to show the per-origin callback URI (derivable from the project's `preview_origins`, but callback surfacing is area 4's).
- **Unpinned presentation after 851.** Once several lineages are real, whether dimming stays sufficient or the schemas list needs a filter.

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: slug identity, immutability, secret invariant, CRUD API open point)
- [`9-crud-api.md`](9-crud-api.md) (area 9: the CRUD surface that answers this read contract)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2: `sso.providers`, dead-capability rule)
- [`4-cli-provider-setup.md`](4-cli-provider-setup.md) (area 4: the console read-only scope note)
- Console ADRs 0001–0004 (`apps/console/docs/adrs/`)
- `apps/console/src/routes/_authed/schemas/` (the screens this area extends)
- `apps/console/src/lib/schema.ts` (`schemaAuthMethods`)
- `apps/console/src/nav.ts` (sidebar entries; the ships-with-endpoint rule)
- `api/openapi/security/oauth2.yaml` (read-scope naming)
