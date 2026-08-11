# CLI Plan

> **Status:** Draft
> **Date:** 2026-04-23
> **Supersedes:** ad-hoc review notes on the `client-cli` POC.

## Context

The [POC CLI](../../../apps/cli) ships the easy half of the product vision: create-before-signup, three environments, framework detection, an agent-grade JSON envelope, and a build-time capabilities registry. Reading the [flow engine](../flowengine/README.md) design alongside the CLI revealed several material re-framings, most recently absorbed from the `frontend-adr-001` branch:

1. **The Lit web component is a BDUI renderer, not a login page.** Login/register are scaffolded by the framework adapter; the thing they host is a server-driven step tree fetched from `/v1/flows`. The renderer parses a **Liquid template** against unordered capability dicts; it does not iterate arrays. See [BDUI Renderer](bdui-renderer.md).
2. **"IDP management" is three separate nouns.** IdPs (login/SSO sources), **external factor providers (MFA) — reserved**, and apps (Zitadel-as-IdP). External factors are deferred until the upstream contract resurfaces. See [Identity Surface](identity-surface.md).
3. **Flow definitions are API resources with a well-defined shape** (canonical spec: [`api/openapi/components/flows/`](../../../api/openapi/components/flows/), draft: [flow-api.yaml](../flowengine/api/flow-api.yaml)). Fields, actions, and gates are **unordered dicts** keyed by name. Every label is a `text_key` resolved client-side via the `| t` filter. The CLI writes a single `.zitadel/flows/default.json` matching this shape, plus `.zitadel/locales/<lang>.json` for translations.
4. **Liquid templates carry a tenant-attack surface**. `zitadel apply` validates every `.zitadel/templates/*.liquid` against the banned set (`| raw`, `<script>`, inline `on*=` handlers) before any upload. See [template-security.md](../flowengine/template-security.md).

Those reframings drive the ordering below.

## Non-goals

- Re-implementing the flow engine or the policy engine client-side. The CLI is a thin management surface over server resources.
- Shipping a real Lit renderer before the flow engine ships. The CLI work is the seam, not the component.
- Replacing the mock platform with a real API. The CLI's job now is to stay honest about what the mock can and cannot do, not to pretend.
- Rebuilding external-factor provider CRUD. Reserved until the upstream shape stabilises.

## Design decisions (locked for this plan)

1. **Noun-first command grouping.** `zitadel idp add`, `zitadel app add`, `zitadel schema add`, `zitadel locale scaffold` — not `zitadel add idp`. The current `zitadel add schema` is aliased for one release, then removed.
2. **Every server resource has a local directory under `.zitadel/`.** `idps/`, `apps/`, `schemas/`, `flows/`, `locales/`, `templates/`. Each file is exactly one resource, named by its slug / language / template name. `zitadel apply` reconciles.
3. **`zitadel apply` is terraform-shaped, not imperative.** It computes a diff, shows a plan, applies. `--auto-approve` for agents; interactive confirmation for humans by default.
4. **Renderer is a zitadel.json field, not a framework adapter variable.** `branding.renderer: "react" | "lit"` (default `"react"` while Lit is unbuilt). Per-framework adapter picks the right template.
5. **`text_key` convention is `<step>.<scope>.<name>`.** Examples: `identifier.title`, `identifier.field.email`, `credential.action.submit`. Enforced by the `flowDefinitionSchema` zod regex.
6. **Liquid templates are referenced, not embedded.** Flow definitions carry `template_name: "default"`. Custom templates live under `.zitadel/templates/<name>.liquid` and are validated + uploaded on apply.
7. **Mock persists to `.zitadel/mock-db.json` under `--mock`.** Without persistence, agents cannot run full lifecycles. *(Still pending.)*
8. **All flow and identity resources carry `version: 1` at the root** so the CLI can migrate local state when the schema evolves.

## Work items

### Phase A — Concept & resource shape ✅

**A.1** — Write [identity-surface.md](identity-surface.md) and [bdui-renderer.md](bdui-renderer.md). ✅

**A.2** — Align local flow resources with `flow-api.yaml` (frontend-adr-001 shape): `fields` / `actions` / `gates` as dicts keyed by name, `texts: { title_key }`, `template_name`, transitions. Default scaffold ships one `FlowDefinition` with `purposes: ["login", "register"]`. ✅

**A.3** — Land user schema annotation vocabulary in the CLI: `x-verify`, `x-mfa`, `x-sensitive`, `x-editable`, `x-unique`, `x-claim` (OIDC token claim mapping), `x-auth-methods`. Warn on unknown `x-*` attrs. Presets: `--preset email`, `phone-mfa-sms`, `full-name`, `date-of-birth`. ✅

**A.4** — Locale + Liquid template tooling:
- `.zitadel/locales/<lang>.json` flat `text_key → string` maps. Setup seeds `en.json`.
- `zitadel locale scaffold [--lang de]` walks flows, adds missing keys (empty string), preserves existing, reports orphans.
- `zitadel locale list` inventories locale files.
- `.zitadel/templates/*.liquid` parsed and validated by `apps/cli/src/templates/validate.ts` (bans `| raw`, `<script>`, `on*=` attrs).
- `apps/cli/src/templates/default.liquid` bundled as the master template. ✅

### Phase B — Identity surface

**B.1** — `zitadel idp add|list|remove|show`. Writes `.zitadel/idps/<slug>.json`. Covers OIDC and SAML; Google/Microsoft/GitHub/Okta presets. ✅

**B.2** — `zitadel external-factor ...` — **deferred**. The upstream external-factor design was withdrawn on `frontend-adr-001` pending consolidation. No resource directory, no commands, no schema. Resume when upstream resurfaces.

**B.3** — `zitadel app add|list|remove|show`. Writes `.zitadel/apps/<slug>.json`. OIDC client and SAML SP. Presets: `spa`, `web`, `native`, `machine`. Optional `role: "server"` for Zitadel-as-IdP. ✅

**B.4** — `zitadel apply` reconciles schemas, flows, idps, apps, locales, templates. Flow definitions zod-validated; templates Liquid-validated. ✅

### Phase C — Renderer abstraction

**C.1** — Renderer abstraction in adapter layer. React renderer ships; Lit renderer is a stub emitting `<zitadel-flow>` scaffolds and depending on `@zitadel/ui-lit` (pending). ✅

**C.2** — `branding.renderer` threaded through setup + doctor. Default `"react"`. ✅

**C.3** — Contract test for adapter × renderer template generation. *Pending.*

### Phase D — Reconciliation loop

**D.1** — `zitadel diff`. Fetch server state for every local resource, diff, output structured JSON (for agents) + pretty table (for humans).

**D.2** — `zitadel plan -o plan.json`. Same diff but serialized to a file for deterministic apply.

**D.3** — `zitadel apply --plan plan.json`. Applies a previously-computed plan. Warns if server state has drifted since the plan was computed.

**D.4** — Drift warning on `zitadel apply` without `--plan`: if server state differs from the last-applied snapshot stored in `.zitadel/state.json`, require `--force` or `--refresh`.

### Phase E — Agent ergonomics

**E.1** — Default to `--non-interactive` when `!process.stdout.isTTY`. Interactive prompts throw `E_INTERACTIVE_REQUIRED` with the exact flag to pass.

**E.2** — Split `E_AUTH` into `E_FS_PERMISSION`, `E_CREDENTIAL_MISSING`, `E_CREDENTIAL_STALE`. Add `E_INTERACTIVE_REQUIRED`, `E_DRIFT`.

**E.3** — Split `agent_status` in the registry into `{ agent: "supported" | "unsupported", mock_behavior: "complete" | "partial" | "none" }`.

**E.4** — Persist mock state to `.zitadel/mock-db.json`. Add `zitadel mock reset`.

**E.5** — Add `cli_version` and `state_version` to `.zitadel/state.json`.

## Phase dependencies

```
A.1 ── A.2 ── A.3 ── B.1
                └──── B.2 ──┐
                └──── B.3 ──┼── B.4 ── D.1 ── D.2 ── D.3 ── D.4
                            │
A.1 ── C.1 ── C.2 ── C.3    │
                            │
                E.1, E.2, E.3, E.4, E.5 — independent; can ship in any order
```

## Verification per phase

- **A** — contract tests; `add schema` round-trip; `zitadel plan` on the default scaffold shows no diff.
- **B** — integration tests that add an IdP/external-factor/app to a fresh project, apply, and see the mock record it.
- **C** — snapshot tests of every renderer × framework template.
- **D** — integration test that drifts the mock by direct mutation, then `zitadel apply` warns.
- **E** — end-to-end agent flow test against `--mock` that covers setup → apply dev → apply production with mock state persisted across runs.

## Open questions

- **App as both client and server.** A Zitadel customer may want to stand up a SAML server for their own customers. Is that one `apps/<slug>.json` resource with `role: "server"`, or a separate `.zitadel/providers/` directory? Leaning toward the former for config surface minimalism; flag the tension in [identity-surface.md](identity-surface.md).
- **Flow definition scope.** The POC assumes "one flow per project." Real customers will want many. Should `.zitadel/flows/` support audience-scoped directories (`flows/org-acme/login.json`), or should the `audience` block inside each file be authoritative? Default to the latter — one flat directory, audience is metadata — with an `audience_selector` CLI flag to list/filter.
- **Renderer migration.** When Lit ships, we want existing React consumers to be able to opt in. Can the renderer abstraction handle both coexisting in one project, or is it one-per-project? Default to one-per-project; revisit if a real customer asks.

## Out of scope for this plan

- Policy engine integration on the CLI side. TBD upstream.
- Real OIDC client in the SDK. Separate track.
- Enterprise features (SAML SP for Zitadel itself, MSA, residency).
- `zitadel eject` improvements beyond what the POC already does.
