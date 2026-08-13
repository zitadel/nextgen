# CLI Plan

> **Status:** Living plan — revised 2026-08-11 against the shipped CLI
> **Supersedes:** the 2026-04-23 draft (which tracked the `client-cli` POC and
> marked several never-built commands as done) and its ad-hoc review notes.

## Where the CLI stands

The shipped surface (see [`apps/cli/README.md`](../../../apps/cli/README.md)
for the generated reference and [`apps/cli/SKILLS.md`](../../../apps/cli/SKILLS.md)
for the agent contract):

| Area | Shipped commands |
|---|---|
| Local runtime | `start`, `stop`, `status`, `logs`, `reset`, `doctor` |
| Scaffolding | `setup` (8 frameworks: next, nuxt, react, vue, angular, solid, svelte, qwik; wizard asks for the login `--design`), `eject` |
| Config reconciliation | `plan`, `apply` (terraform-shaped: diff → plan → apply) |
| Resources | `schemas list`, `branding eject` |
| Ownership | `claim` ([ADR 046](../../adrs/046-claim-lifecycle-v2.md)) — init/status/complete against the server's claim endpoints, team attachment reported in `setup`/`status`/`doctor` |

Three resource kinds reconcile through `plan`/`apply`: **user schemas**
(revisioned — editing publishes a new revision, never an update), **flow
definitions** (create/read/list/update/delete), and **branding revisions**
([ADR 040](../../adrs/040-tenant-login-templates-editable-config.md) /
[ADR 045](../../adrs/045-copy-overlays-as-branding-revisions.md)). Their local
homes are `.zitadel/schemas/`, `.zitadel/flows/`, and `.zitadel/branding/`,
scaffolded from [`packages/config/defaults/`](../../../packages/config/defaults/)
with per-directory READMEs that ship into the customer repo.

Scaffolded-file ownership, drift detection, and repair live in `doctor` per
[ADR 042](../../adrs/042-scaffolded-file-ownership-and-drift-detection.md);
framework version floors are enforced per
[ADR 043](../../adrs/043-framework-version-floors.md); embedding posture
(standalone page vs widget in a pre-existing app) is derived from the app per
[ADR 044](../../adrs/044-scaffold-embedding-posture-defaults.md).

## Design decisions (still standing)

1. **Noun-first command grouping** — `zitadel schemas list`,
   `zitadel branding eject`.
2. **Every reconciled server resource has a local directory under `.zitadel/`**,
   one file per resource; `zitadel apply` reconciles.
3. **`zitadel apply` is terraform-shaped, not imperative** — diff, plan, apply;
   `--auto-approve` for agents.
4. **Flow definitions are API resources** with the canonical spec under
   [`api/openapi/components/flows/`](../../../api/openapi/components/flows/).
   `fields` and `actions` are **ordered arrays** whose entries carry `name`
   ([ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md));
   every label is a `text_key` resolved client-side via the `| t` filter.
   [`packages/config/defaults/default-login.json`](../../../packages/config/defaults/default-login.json)
   is the authority for step shape.
5. **Liquid templates are referenced, not embedded.** Branding revisions carry
   `liquid_template_file` references; the CLI inlines on upload. The bundled
   master template is
   [`packages/components/src/orchestrator/templates/default.liquid`](../../../packages/components/src/orchestrator/templates/default.liquid);
   the design catalog lives under
   [`packages/config/defaults/branding/`](../../../packages/config/defaults/branding/)
   (`centered`, `split`, `split-right`, `hero`, `minimal`).
6. **Templates carry a tenant-attack surface** — validated against the banned
   set before upload; see
   [template-security.md](../flowengine/template-security.md).

## Not built (formerly marked done in the 2026-04 draft — they were not)

- `zitadel idp add|list|remove|show` and `.zitadel/idps/` — no IdP management
  surface exists.
- `zitadel app add|list|remove|show` and `.zitadel/apps/` — no app management
  surface exists.
- `zitadel locale scaffold|list` and `.zitadel/locales/` — locale tooling does
  not exist; copy customization ships as branding **copy overlays**
  ([ADR 045](../../adrs/045-copy-overlays-as-branding-revisions.md)) instead.
- `zitadel external-factor …` — still deferred; no upstream contract.

## Direction

- **BDUI renderer** — the web-component renderer id (`web-component`) is
  declared but deliberately unavailable; scaffolding uses the `react` renderer.
  The `@zitadel/ui-lit` package remains a reserved direction (the placeholder
  spec in `apps/cli/src/lib/orca/patchers/rule/next/renderers/lit/` reserves
  the integration shape). See [BDUI Renderer](bdui-renderer.md).
- **Identity surface** (IdPs, apps, external factors) — see
  [Identity Surface](identity-surface.md); commands land only once the server
  exposes the resources.
- **Locale tooling** — revisit once copy overlays prove insufficient.

## Verification

The CLI's behavior contract is enforced by `apps/cli` unit tests
(`moon run cli:test`), the journey e2e lanes (`apps/cli-journey-e2e`, four
CI-gated variants: fresh-app, passkey, pre-existing-app, testkit), and the
doctor drift checks of ADR 042.
