# CLI Design

> **Status:** Draft — plan + two concept docs for team feedback before implementation.
> **Date:** 2026-04-23
> **Context:** The [POC CLI](../../../apps/cli) (`client-cli` branch) has strong foundations — JSON envelope, capabilities registry — but needs to align with the [flow engine](../flowengine/README.md) design and gain the identity-management surface that the product vision requires.

## What needs feedback

Two conceptual commitments before we write more code:

- **[Identity Surface](identity-surface.md)** — how the CLI exposes IdPs, external auth factors, and apps (Zitadel-as-IdP/OIDC/SAML server) as separately-managed, GitOps-reconciled resources. Biggest open shape question: what lives in `.zitadel/` vs. what is purely server-side state.
- **[BDUI Renderer](bdui-renderer.md)** — how the Lit-based login UI integrates with framework adapters. Biggest open shape question: is the renderer a single `<zitadel-flow>` web component that consumes the flow engine directly, or does the adapter-scaffolded page wrap it per-framework?

## What lives in `.zitadel/` (and what doesn't)

**Ownership decides the surface.** The CLI is for resources the dev owns — bounded, deliberate, reproducible across environments. The runtime API is for resources someone else owns: end users, B2B customer-org admins, registration / SSO / SCIM, and any unbounded set the deployment produces over time. The split isn't architectural — every CLI `apply` ultimately hits the same API a runtime caller would — but ownership and cardinality decide which surface is the right entry point.

A quick test: *"Would I want a PR for each one of these?"* If yes, it's a CLI resource. If no — if the count grows with traffic, with customer organizations, or with anyone-but-the-dev — it belongs on the runtime API.

**Subordinate config follows its parent.** Claim mappings, redirect URIs, role bindings, and similar attached config live wherever the resource they belong to lives. A default Google IdP defined in `.zitadel/idps/google.json` carries its claim mapping in that file. A B2B customer's runtime-created Okta IdP carries its claim mapping in the API call that creates it. There is no separate "claim-mapping registry" per surface — the child config rides with the parent.

The resource kinds the CLI manages (shipped: schemas, flows, branding; the
rest are target design), each with a runtime-API counterpart where one exists:

| Resource | `.zitadel/<dir>/` | Status | Runtime-API counterpart |
|---|---|---|---|
| User schema | `schemas/` — what a user looks like on your platform | shipped | dev-owned only |
| Flow | `flows/` — login / register / recovery definitions | shipped | dev-owned only |
| Branding | `branding/` — design, tokens, Liquid template, copy overlays | shipped | tenant-editable after eject; see [template-security.md](../flowengine/template-security.md) |
| IdP | `idps/` — your default sign-in sources | design | per-customer-org SSO from your B2B admin UI |
| App | `apps/` — your first-party apps and machine clients | design | customer-managed apps, dynamic client registration |
| Locale | `locales/` — translation dictionaries | design (copy overlays shipped instead, [ADR 045](../../adrs/045-copy-overlays-as-branding-revisions.md)) | dev-owned only |

The canonical directory handling lives in the sync engine
([`apps/cli/src/lib/sync/syncers.ts`](../../../apps/cli/src/lib/sync/syncers.ts));
Liquid templates are loaded as `.liquid` files referenced from branding, not as
`.json` resources.

**Things that intentionally have no `.zitadel/` directory** — users, sessions, audit events, per-customer-org IdPs and apps. They're unbounded or owned by someone other than the dev. Bootstrapping a small set (e.g. a first admin user in staging) is the job of a *planned* one-shot imperative CLI surface that hits the API but doesn't get tracked in git. Concrete command names are deliberately absent here until the surface ships in the registry.

**Worked examples** matching the recurring B2B questions:

- *"Default Google SSO for my login page."* → `.zitadel/idps/google.json`, applied via `zitadel apply`.
- *"My B2B customers each wire up their own Okta."* → Your B2B admin UI calls the runtime IdP API per customer-org. Not the CLI.
- *"Bootstrap a couple of admin users in staging."* → Planned imperative bootstrap surface (not yet in the registry), not a file in `.zitadel/`.
- *"Map `groups` from my customer's runtime-created IdP into a role claim."* → Subordinate config follows the parent: the IdP was created via API, so its claim mapping lives in that API call. Dev-side flow actions can transform claims after the fact, but they don't live in `.zitadel/idps/`.

The per-resource sections in [identity-surface.md](identity-surface.md) carry a *Scope* callout restating this for each kind. AI agents reading [apps/cli/SKILLS.md](../../../apps/cli/SKILLS.md) see the current invocation rules.

## Plan

The gap analysis against the product vision is tracked in [PLAN.md](PLAN.md). Ordering rationale:

1. Lock the two concept docs (this batch).
2. Align the local resource shapes with the shipped spec under [`api/openapi/components/flows/`](../../../api/openapi/components/flows/) so `zitadel apply` corresponds 1:1 with server resources.
3. Build the identity surface commands.
4. Introduce the renderer abstraction and the Lit plug-in point.
5. Add the diff/plan/apply reconciliation loop.

## Related

- [Flow Engine](../flowengine/flow-engine.md)
- [Flow Engine — Developer Guide](../flowengine/flow-engine-guide.md)
- [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md) — capability dicts + Liquid templates + `text_key` localization
- [Template Security](../flowengine/template-security.md) — invariants the CLI validates on `apply`
- [User Schema Integration](../flowengine/user-schema.md)
- [CLI source](../../../apps/cli)
- [CLI agent guidance](../../../apps/cli/SKILLS.md)
