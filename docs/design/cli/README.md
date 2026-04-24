# CLI Design

> **Status:** Draft — plan + two concept docs for team feedback before implementation.
> **Date:** 2026-04-23
> **Context:** The [POC CLI](../../../apps/cli) (`client-cli` branch) has strong foundations — JSON envelope, pre-claim/claim split, capabilities registry — but needs to align with the [flow engine](../flowengine/README.md) design and gain the identity-management surface that the product vision requires.

## What needs feedback

Two conceptual commitments before we write more code:

- **[Identity Surface](identity-surface.md)** — how the CLI exposes IdPs, external auth factors, and apps (Zitadel-as-IdP/OIDC/SAML server) as separately-managed, GitOps-reconciled resources. Biggest open shape question: what lives in `.zitadel/` vs. what is purely server-side state.
- **[BDUI Renderer](bdui-renderer.md)** — how the Lit-based login UI integrates with framework adapters. Biggest open shape question: is the renderer a single `<zitadel-flow>` web component that consumes the flow engine directly, or does the adapter-scaffolded page wrap it per-framework?

## Plan

The gap analysis against the product vision is tracked in [PLAN.md](PLAN.md). Ordering rationale:

1. Lock the two concept docs (this batch).
2. Align the local resource shapes with `docs/design/flowengine/api/flow-api.yaml` so `zitadel apply` corresponds 1:1 with server resources.
3. Build the identity surface commands.
4. Introduce the renderer abstraction and the Lit plug-in point.
5. Add the diff/plan/apply reconciliation loop.
6. Harden the claim lifecycle + agent ergonomics.

## Related

- [Flow Engine](../flowengine/flow-engine.md)
- [Flow Engine — Developer Guide](../flowengine/flow-engine-guide.md)
- [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md) — capability dicts + Liquid templates + `text_key` localization
- [Template Security](../flowengine/template-security.md) — invariants the CLI validates on `apply`
- [User Schema Integration](../flowengine/user-schema.md)
- [CLI source](../../../apps/cli)
- [CLI agent contract (generated)](../../../apps/cli/CLAUDE.md)
