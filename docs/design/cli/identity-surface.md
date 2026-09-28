# CLI Identity Surface

> **Status:** Draft — concept doc, not an implementation spec. None of the
> `zitadel idp` / `zitadel app` commands or `.zitadel/{idps,apps}/` directories
> described here are built; they land only once the server exposes the
> resources. Shipped CLI resources today: schemas, flows, branding.
> 
> **Superseded in part:** the IdP resource half is superseded by
> [`../idp/`](../idp/README.md); the connection shape below predates area 1
> ([`../idp/1-resource-model.md`](../idp/1-resource-model.md): `kind`, `enabled`,
> `audience`, `default_schema` are dropped there, secrets, claim mapping, and
> the provisioning flags reshaped). Still current here: the App resource and the
> external-MFA placeholder.
> **Date:** 2026-04-23 (revised after `frontend-adr-001` folded the external-factor research doc; status note updated 2026-08-11)
> **See also:** [CLI Plan](PLAN.md) · [Flow Engine](../flowengine/flow-engine.md) · [Flow Engine — Step Response Shape](../flowengine/flow-engine-nodes.md) · [User Schema](../flowengine/user-schema.md)

## Problem

The product vision says "devs and AI agents manage IDPs, OIDC/SAML server config, and user schemas through the CLI." The POC treats "IDP" as a single vague noun and exposes nothing for managing it. In this iteration, "IDP" resolves into two concrete CLI resources — IdP and App — plus a reserved placeholder for external MFA providers (deferred upstream):

| Concept | What it is | Where it plugs in |
|---|---|---|
| **IdP** (identity provider) | An *external* system the end user signs in with: Google, Microsoft, Okta, Azure AD, corporate SAML. | Referenced by `identifier` / `credential` steps in flow definitions. Callback at `/idp/callback` for user provisioning and claim mapping. |
| **External factor provider** — **reserved** | An *external MFA* system (Duo, YubiKey, RSA SecurID, etc.). | The upstream flow engine design for external factors is in flux; the prior research document was removed on `frontend-adr-001` pending consolidation. This CLI therefore does **not** yet expose an external-factor resource directory or command. A follow-up design will add `.zitadel/external-factors/` and `zitadel external-factor add` once upstream publishes the final step-type / protocol contract. |
| **App** | A consumer of Zitadel's own OIDC/SAML server: an OIDC client, a SAML SP, an API audience. "The thing that has a client_id and client_secret." | Receives tokens from Zitadel after a flow completes. Optionally acts as a SAML *server* when the Zitadel instance is fronting its own customers' auth. |

Treating these as one noun conflates credentials, lifecycles, and UX. Treating them separately matches the server resource model, matches how customers think, and matches how agents need to script them.

## The three resources

### IdP — `.zitadel/idps/<slug>.json`

> **Scope.** This is for your platform's default sign-in sources — Google, your corporate Okta, your default SAML IdP. For per-customer-org SSO (a B2B customer configuring their own Okta through your admin UI), use the runtime IdP API, not the CLI. Subordinate config (claim mapping, scopes) rides with the IdP itself: dev-owned IdPs carry it in the file; runtime-created IdPs carry it in the API call that creates them. See [What lives in `.zitadel/`](README.md) for the full ownership rule.

A trust relationship with an external identity provider. Zitadel redirects the user there, receives claims, provisions or links a local user.

```json
{
  "version": 1,
  "kind": "idp",
  "slug": "google",
  "display_name": "Google",
  "protocol": "oidc",
  "enabled": true,
  "audience": { "scope": "team", "team_id": "acme" },
  "oidc": {
    "issuer": "https://accounts.google.com",
    "client_id": "1234.apps.googleusercontent.com",
    "client_secret_env": "ZITADEL_IDP_GOOGLE_SECRET",
    "scopes": ["openid", "email", "profile"],
    "claim_mapping": {
      "email": "email",
      "given_name": "given_name",
      "family_name": "family_name"
    }
  },
  "provisioning": {
    "mode": "auto_link_by_email",
    "link_by": ["claims.email"],
    "auto_create_user": true,
    "default_schema": "user-human"
  }
}
```

For SAML IdPs, swap the `oidc` block for `saml` with `metadata_url` or inline `metadata_xml`. The CLI validates metadata on `add` and warns if the SAML clock skew is unset.

**CLI shape:**

```
zitadel idp add --preset google --client-id ... --env-secret ZITADEL_IDP_GOOGLE_SECRET
zitadel idp add --protocol oidc --issuer https://... --client-id ...
zitadel idp add --protocol saml --metadata-url https://...
zitadel idp add --from-file ./my-okta.json
zitadel idp list
zitadel idp show google --json
zitadel idp remove google
zitadel idp test google   # dry-run discovery + token exchange (mockable)
```

**Claim mapping** is the single most agent-hostile piece of this surface. Default to sensible mappings for each preset; for custom OIDC/SAML, force the CLI to emit the full mapping explicitly so agents can see what claims flow where.

### External factor provider — reserved (deferred)

> **Scope (when this lands).** Same rule as IdPs: dev-owned default factor providers (your platform's default Duo or YubiKey integration) belong in `.zitadel/external-factors/`; customer-owned per-org factor providers go through the runtime API. See [What lives in `.zitadel/`](README.md) for the ownership rule.

Placeholder. The upstream design for external MFA providers is currently unpublished: the prior research document was removed on `frontend-adr-001` pending consolidation of step types, protocol adapters, and ACR semantics. Until that design resurfaces, this CLI does not expose an external-factor resource directory, command, or schema. Built-in factors (password, passkey, captcha gates) remain available through flow steps and `gates`.

When upstream is ready, the resurrected surface is expected to live at `.zitadel/external-factors/<slug>.json` with `zitadel external-factor add|list|show|remove` commands — but the concrete shape (protocol adapters, patterns, ACR properties) will track the upstream decision rather than the prior prototype.

### App — `.zitadel/apps/<slug>.json`

> **Scope.** This is for your platform's first-party apps (your web frontend, your mobile app) and machine clients. For customer-managed apps and dynamic client registration — common in B2B platforms where each customer brings their own consumer of your APIs — use the runtime apps API, not the CLI. See [What lives in `.zitadel/`](README.md) for the ownership rule.

A consumer of Zitadel's OIDC/SAML server. This is "the thing with a client_id that receives tokens." Also optionally the seat of Zitadel-as-IdP scenarios where the customer is running a SAML server for their own customers.

```json
{
  "version": 1,
  "kind": "app",
  "slug": "web-frontend",
  "display_name": "Web Frontend",
  "protocol": "oidc",
  "role": "client",
  "enabled": true,
  "audience": { "scope": "project" },
  "oidc": {
    "client_type": "web",
    "auth_methods": ["client_secret_basic", "private_key_jwt"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "redirect_uris": [
      "https://acme.com/callback",
      "http://localhost:3000/callback"
    ],
    "post_logout_redirect_uris": ["https://acme.com/"],
    "access_token_type": "jwt",
    "id_token_claims": ["email", "given_name", "family_name"],
    "skip_consent": true
  }
}
```

For a SAML service provider, `protocol: "saml"` with a `saml` block (entity ID, ACS URL, metadata). For a SAML *server* — i.e. Zitadel acting as the IdP for a customer-controlled SP — `role: "server"` and the CLI fetches Zitadel's metadata and emits IdP XML for the SP side to consume.

**CLI shape:**

```
zitadel app add --preset spa --redirect-uri http://localhost:3000/callback
zitadel app add --protocol oidc --redirect-uri https://acme.com/callback --client-type web
zitadel app add --protocol saml --metadata-url https://sp.acme.com/metadata
zitadel app add --protocol saml --role server --entity-id urn:acme:zitadel
zitadel app list
zitadel app show web-frontend --json
zitadel app metadata web-frontend   # emits metadata for the counterparty (SAML)
```

**Open question — `role: "server"` placement.** A customer using Zitadel to auth their own customers might declare:

```json
{ "kind": "app", "role": "server", "protocol": "saml", ... }
```

…but this stretches what "app" means. Alternative is a separate `.zitadel/providers/` directory. The ownership lens resolves this: if the dev owns the SAML-server config (one for their whole platform), it's a `.zitadel/apps/<slug>.json` with `role: "server"` — a small, deliberate, dev-owned resource. If the customer owns it (one per customer-org, configured via a B2B admin UI), it doesn't belong in `.zitadel/` at all and goes through the runtime API. Current leaning: keep `role: "server"` on `app` for the dev-owned case to avoid two near-identical resource types; per-customer SAML servers don't get a CLI surface.

## How they plug into flow definitions

[Flow definitions](../flowengine/flow-engine.md) are `.zitadel/flows/<slug>.json` files shaped like `FlowDefinition` (canonical spec: [`api/openapi/components/flows/`](../../../api/openapi/components/flows/)). `fields` and `actions` are ordered arrays whose entries carry a `name` ([ADR 021](../../adrs/021-ordered-arrays-for-step-fields-actions-gates.md)); `gates` is keyed by gate type; every user-visible label is a `text_key` resolved client-side via LiquidJS's `| t` filter (see [flow-engine-nodes.md](../flowengine/flow-engine-nodes.md)). Steps reference identity resources:

- An `identifier` step's `sso_providers` list resolves against `.zitadel/idps/`.
- An `app`'s `audience` (via the flow's `audience.app_ids`) scopes which flow runs for which token consumer.
- Gates (`captcha`, `passkey`) are built-in; external-factor gates are deferred until the upstream contract lands.

**Cross-resource references are validated on `zitadel apply`.** If a flow names an `idp` slug that has no file, apply errors with `E_VALIDATION` and `next_commands: ["zitadel idp add --preset okta"]`.

## Secrets

Every sensitive value is an `*_env` reference, never a literal:

```json
"client_secret_env": "ZITADEL_IDP_GOOGLE_SECRET"
```

The CLI never writes secrets to disk in resource files. `zitadel apply` reads the env at apply time, validates presence, and sends to the server. Missing envs: `E_CREDENTIAL_MISSING` with a pointer to `.env.local`.

Why `_env` in the file rather than `.env.local` mapping in one place: agents editing a single resource file see the full shape without cross-referencing. Humans reading a PR diff see which env vars this resource depends on. The CLI generates an `.env.example` with every referenced var stubbed out.

## GitOps apply

`zitadel apply` processes resources in dependency order:

1. Schemas (no dependencies).
2. IdPs (no internal dependencies, but referenced by flows).
3. Apps (referenced by flows via audience).
4. Flow definitions (reference all of the above).
5. Locales (`.zitadel/locales/*.json`) and Liquid templates (`.zitadel/templates/*.liquid`) — validated and uploaded alongside the bundle.

Within each stage: `diff` → `plan` → `apply`, atomic per resource. If one resource fails, the CLI stops before processing dependents and reports the failing resource; already-applied resources stay applied (idempotent). This matches Terraform's partial-apply semantics and is the model agents understand.

Flow definitions are validated against the `FlowDefinition` zod schema before any network call. Liquid templates are parsed and scanned for the banned set (`| raw`, `<script>`, inline `on*=` handlers) — see [Template Security](../flowengine/template-security.md).

For a preview-style workflow, `zitadel plan -o plan.json` captures the state; `zitadel apply --plan plan.json` executes it deterministically. Agents should always use the two-step form.

## Mock semantics

The mock platform must:

- Store created IdPs/apps in `.zitadel/mock-db.json` (persistence across invocations). *Planned — see CLI Plan phase D/E.*
- Respond to `test` commands with synthetic-but-believable shapes (OIDC discovery, SAML metadata).
- Reject cross-resource references that don't exist locally (mirroring server validation).
- Never require real network calls. Everything that would hit an external provider is stubbed with deterministic outputs.

Without this, agents cannot dry-run the identity surface — which is precisely the use case the surface exists to serve.

## What this doc does not cover

- Policy rules that decide *when* MFA is required (policy engine — TBD).
- Enrollment flows (e.g., first-time Futurae device binding). That's a flow-definition concern, not an identity-resource concern.
- Trust-on-first-use heuristics for custom IdPs — we require explicit configuration.
- The runtime API surface (`/idps`, `/apps`, etc. — none of which exist in the shipped spec yet). This doc is only about the CLI's local file shape and command tree.

## Open questions

- **IdP vs app confusion.** "I want Zitadel to be the IdP for my SaaS customers" is structurally the same as "I have a SAML SP." But users ask it as "how do I become an IdP?" Worth a docs-level disambiguation plus perhaps a `zitadel saml-server` command alias.
- **Claim-mapping DSL.** The current shape uses JSONPath-like strings (`"email": "email"`). Complex mappings (concat, conditional, normalization) will push us toward expressions. Leaning toward "start with JSONPath; adopt a typed expr language when the first real customer hits a wall."
- **`external-factor test` cost model.** For real providers this hits a real network. Gate it behind `--live` explicitly.
- **Provider catalog.** Should the CLI ship a registry of known providers (presets) or fetch it from the server? Fetching would let us update presets without CLI releases, at the cost of a network hop on first use. Start with bundled presets; add a `--refresh-presets` later.
