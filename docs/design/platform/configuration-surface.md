# Configuration Surface

> **Status:** Draft
> **See also:** [README](README.md) · [Overview](overview.md) · [Project Secret](secret.md) · [Claim Flow](claim-flow.md) · [Config API](api/config-api.yaml) · [Flow Engine](../flowengine/flow-engine.md)

The configuration surface is the set of artifacts a developer checks into source control to describe what their Zitadel project does: flow definitions, identity providers, user schemas, branding, environment-specific issuer origins. The server is **not** the source of truth for any of this; the repo is. `npx zitadel push` uploads the server-behavior subset on demand; the dev-server hook runs it automatically when the config hash changes.

This document specifies the file format, directory layout, versioning mechanism, environment-override model, secrets handling, and the config-versus-resource boundary.

## Zitadel does not manage domains as infrastructure

In the MVP, Zitadel does not mint subdomains, provision TLS certificates, or configure DNS. What Zitadel *does* is **know about the origins a project is allowed to operate under** — as a security boundary (Origin validation on browser and origin-bound runtime requests), as token issuer context (the `iss` claim rendered in issued tokens), and as email-rendering context (the hostname that appears in magic-link URLs).

Those declarations live in `environments.*.issuer` and are enforced at runtime. The customer's app serves every user-visible surface on its own origin. When a future tier adds SPA support or Zitadel-hosted login, infrastructure-level domain management will come with it — scoped to that tier, not retroactively bolted on.

## The split: config vs. resources

The organizing principle is a clean separation between two kinds of artifacts.

**Configuration** is the shape of the system — what the login page looks like, which IDPs are available, which fields users have, what the policies are. It changes rarely, is described declaratively, and benefits from code review, branching, and rollback. It belongs in the developer's repository.

**Resources** are the data of the system — users, sessions, tokens, grants, audit events. It changes constantly, is mutated by the system at runtime, and would be catastrophic to commit to source control. It belongs on the server, managed via API or MCP.

The boundary is explicit, not aspirational:

| In `zitadel.json` / `.zitadel/` (GitOps) | Via API / MCP (data plane) |
|---|---|
| Flow definitions | Users |
| Identity provider configs (type, issuer, client ID, scopes) | Sessions |
| User schemas | Tokens, grants |
| Branding, LiquidJS templates, ejected Lit components | Audit logs |
| Translation keys and strings | IDP client secrets (only refs in config) |
| Policies (password, MFA, risk) | Metrics, dashboards |
| Rate limit preferences | Debug state |
| Declared issuer origins per environment *(security + context)* | Application / client definitions (cross-project) |
| Email template text and locales | Email send events, bounce state |
| Allowed redirect URI patterns | Issued tokens, refresh tokens |
| Fallback flows for legacy clients | Machine-to-machine credentials (secrets) |
| `branding.renderer` mode + attribution preference | Rendered HTML output (runtime, per request) |

**Declared issuers serve a double purpose.** They are both a *security allowlist* (the server validates every request's `Origin` against this list) and *context data* (the matched issuer is rendered into the `iss` claim of issued tokens and into the hostname of magic-link URLs). Getting that list wrong breaks integrations silently; the linter built into `npx zitadel push` flags declared issuers that do not look reachable.

When the boundary is ambiguous, apply the test: *does this artifact describe how the system behaves, or is it data the system produces?* The former is config. The latter is a resource.

## `zitadel.json` — the root

`zitadel.json` lives at the root of the developer's repository. It is the only file the SDK looks for at startup. It can either contain all configuration inline, or it can reference companion files in the `.zitadel/` directory.

A minimal example:

```json
{
  "$schema": "https://schemas.zitadel.com/v2/project.schema.json",
  "project": "proj_01hexample",
  "flows": {
    "login": ".zitadel/flows/login.json",
    "register": ".zitadel/flows/register.json"
  },
  "environments": {
    "development": { "issuer": "http://localhost:3000" },
    "production": { "issuer": "https://acme.com" }
  }
}
```

A comprehensive example showing every top-level field:

```json
{
  "$schema": "https://schemas.zitadel.com/v2/project.schema.json",
  "project": "proj_01hexample",

  "flows": {
    "login": ".zitadel/flows/login.json",
    "register": ".zitadel/flows/register.json",
    "recovery": ".zitadel/flows/recovery.json"
  },

  "idps": {
    "google": {
      "type": "oidc",
      "issuer": "https://accounts.google.com",
      "clientId": "${GOOGLE_CLIENT_ID}",
      "clientSecret": "${GOOGLE_CLIENT_SECRET}",
      "scopes": ["openid", "email", "profile"]
    },
    "github": {
      "type": "oidc",
      "issuer": "https://token.actions.githubusercontent.com",
      "clientId": "${GITHUB_CLIENT_ID}",
      "clientSecret": "${GITHUB_CLIENT_SECRET}",
      "scopes": ["read:user", "user:email"]
    }
  },

  "schemas": {
    "user": ".zitadel/schemas/user.json",
    "customer": ".zitadel/schemas/customer.json"
  },

  "branding": {
    "renderer": "default",
    "attribution": "visible",
    "template": ".zitadel/branding/login.liquid",
    "theme": ".zitadel/branding/theme.json",
    "translations": ".zitadel/i18n"
  },

  "policies": {
    "password": ".zitadel/policies/password.json",
    "mfa": ".zitadel/policies/mfa.json"
  },

  "environments": {
    "development": { "issuer": "http://localhost:3000" },
    "preview":    {
      "issuer_pattern": "https://*.vercel.app",
      "branding": { "theme": ".zitadel/branding/theme.preview.json" }
    },
    "production": {
      "issuer": ["https://acme.com", "https://app.acme.com"],
      "idps": {
        "google": {
          "clientId": "${GOOGLE_CLIENT_ID_PROD}",
          "clientSecret": "${GOOGLE_CLIENT_SECRET_PROD}"
        }
      }
    }
  }
}
```

**Path convention.** Relative paths point into `.zitadel/` — the hidden-dotdir layout shown at [Directory layout](#directory-layout). Paths resolve relative to the directory containing `zitadel.json`; a leading `./` is accepted but not shown in examples, so the same string works in JSON and shell contexts without the dotdir being mistaken for a sibling non-hidden directory.

| Field | Required | Purpose |
|---|---|---|
| `$schema` | Recommended | Pins schema version for IDE validation. Should match the installed SDK version. |
| `project` | Yes | The dialect-minted `project_id` (`proj_<opaque>`, [ADR 047](../../adrs/047-dialect-id-generation.md)). Must match `.zitadel/secret`. Treat the body as opaque; it is an identifier, not a user-facing URL. |
| `flows` | No | Flow definitions by purpose. Values are inline objects or relative file paths. |
| `idps` | No | Identity providers. Keys are developer-chosen stable names. |
| `schemas` | No | User schemas. Keys are schema names referenced from flow definitions. |
| `branding` | No | Renderer mode, attribution, template, theme tokens, translations. See [Branding](#branding). |
| `policies` | No | Password policy, MFA policy, risk policy, delivery policy. |
| `environments` | Yes (at least one) | Per-environment overrides. Each environment carries an `issuer` (string / array) or `issuer_pattern`. See [Environments](#environments). |

Keys that are objects can also be inline:

```json
{
  "flows": {
    "login": {
      "steps": [{ "type": "identifier" }, { "type": "credential" }]
    }
  }
}
```

The file-reference form is recommended for anything non-trivial so that diffs stay scoped and reviewers can focus on one concern at a time.

## Directory layout

```
my-app/
├── zitadel.json                        (source-controlled, root of config)
├── .zitadel/
│   ├── secret                          (gitignored — see secret.md)
│   ├── flows/
│   │   ├── login.json                  (source-controlled)
│   │   ├── register.json
│   │   └── recovery.json
│   ├── schemas/
│   │   ├── user.json
│   │   └── customer.json
│   ├── branding/
│   │   ├── login.liquid                (LiquidJS template — see note below)
│   │   ├── theme.json
│   │   └── theme.preview.json
│   ├── i18n/
│   │   ├── en.json
│   │   ├── de.json
│   │   └── ja.json
│   └── policies/
│       ├── password.json
│       ├── mfa.json
│       └── risk.json
└── .gitignore                          (excludes .zitadel/secret)
```

**What is and is not source-controlled:**

| Path | Source-controlled | Notes |
|---|---|---|
| `zitadel.json` | Yes | Root config. |
| `.zitadel/secret` | **No** | Contains the project secret + preview secret. Gitignored by setup CLI. |
| `.zitadel/flows/**` | Yes | Flow definitions. |
| `.zitadel/schemas/**` | Yes | User schemas. |
| `.zitadel/branding/**` | Yes | Templates and theme tokens. Secrets never live here. |
| `.zitadel/i18n/**` | Yes | Translation bundles. |
| `.zitadel/policies/**` | Yes | Policy definitions. |
| `.env` / `.env.local` | **No** | Environment variable values. Gitignored. |
| `.env.example` | Yes | Variable names (no values), shipped by setup CLI. |

The setup CLI ensures `.gitignore` contains `.zitadel/secret` and `.env*` (with an exception for `.env.example`) on first run. It does not overwrite existing entries; it appends if missing.

## Branding

The customer's app renders every user-visible surface. `branding.renderer` chooses which of three rendering strategies is used:

| `renderer` value | What it means |
|---|---|
| `"default"` *(default)* | The published auth web component renders every flow. Zero custom author code. Style via CSS custom properties. Attribution slot rendered per `branding.attribution`. |
| `"template"` | LiquidJS template (e.g. `.zitadel/branding/login.liquid`) declares the HTML around server-provided nodes. Customer owns the markup; server owns the data. |
| `"ejected"` | The component source has been scaffolded into the customer's repo by `npx zitadel add sign-in` (or similar). Customer owns layout, behavior, tracking, everything. A protocol-version pin in the ejected source tracks which Flow v1 range the component supports. |

### Which renderer should I use?

- **Pick `"default"`** when you want auth to *just work* and are happy with CSS-level theming. This is the fastest path — one web component tag, no HTML to write.
- **Pick `"template"`** when you want full HTML control but don't want to write or maintain JavaScript. Your LiquidJS template declares the layout; the server tells you which nodes to render where. Good for teams with design-system HTML/CSS but no component-library workflow.
- **Pick `"ejected"`** when you want full control including behavior — custom animations, complex multi-step wizards, non-standard input types, analytics hooks, progressive enhancement. The ejected source lives in your repo like any other component you maintain.

All three strategies consume the same server-sent data (**Flow v1 nodes** — a structured node contract where each step describes required inputs, errors, and continuation actions as data). Structured-node rendering for server-driven auth UI is well-established prior art; the Flow v1 spec itself is a follow-up doc. The key property for this doc: **nodes are data owned by the server, markup is rendering owned by the customer**. They are complementary, not competing.

### Attribution

`branding.attribution` is one of `"visible"` (default) or `"hidden"`. The attribution slot renders a small "Powered by Zitadel" link. On Free tier, `"hidden"` is accepted by the SDK but the server still injects a `zitadel_attribution` node — Free projects see it regardless of the client's preference. On Pro tier, `"hidden"` is honored.

This is a **commercial gate, not a security gate**. Pre-claim, Zitadel doesn't host anything the user sees (the page renders on the customer's own origin), so "trust mark" concepts don't apply. Attribution exists for brand ownership on paid plans, full stop.

### What uploads to the server; what stays local

Different renderer modes upload different artifacts:

| Field | Uploaded to server? | Why |
|---|---|---|
| `flows`, `idps`, `schemas`, `policies` | **Yes** | Server behavior depends on these. |
| `environments.*.issuer` / `issuer_pattern` | **Yes** | Security allowlist + token/email context. |
| `branding.renderer`, `branding.attribution` | **Yes** | Flags the server consults when deciding which node set to emit. |
| `branding.template` path | Reference only | The server does not parse the LiquidJS; the customer's app does the rendering. |
| `branding.theme` tokens | Reference only | Theme tokens live in the customer's built assets. |
| `branding.translations` directory | Reference only | Translation JSON is bundled into the customer's app. |
| Ejected component source | **Not uploaded** | Lives in the customer's repo; compiled into the customer's bundle. |

This is the thing that distinguishes Level 1 from Level 3 (hosted login, deferred). In Level 1, the customer's app renders — so Zitadel does not need markup. When Level 3 ships, hosted login will upload the full bundle because Zitadel will serve it.

## Versioning and `$schema`

Every `zitadel.json` should carry a `$schema` reference:

```json
{
  "$schema": "https://schemas.zitadel.com/v2/project.schema.json"
}
```

The schema version corresponds to the installed `@zitadel/sdk` version. A developer who upgrades their SDK gets a new schema URL suggested by the SDK's post-install script; downgrading works the same way in reverse.

**What the schema gives you at author time:** IDE autocomplete, inline field documentation, required-field checking, enum validation, and — critically — detection of new capabilities. When a future SDK introduces captcha steps, the new schema adds `captcha` to the step-type enum. An editor using the old schema that encounters `"type": "captcha"` will flag it immediately.

**What the schema does not give you:** runtime capability verification. A project might be configured with v2.1 features while talking to a Zitadel deployment that has not yet rolled out v2.1 server support. This is where the capabilities handshake comes in.

### Capabilities handshake

On every `PATCH /projects/{projectId}/config`, the server responds with:

```json
{
  "config_version": 17,
  "applied_at": "2026-04-21T14:03:11Z",
  "hash": "sha256:...",
  "server_capabilities": {
    "schema_version": "2.0",
    "flow_protocol_version": "1.0",
    "step_types": ["identifier", "credential", "form", "verification",
                   "policy_check", "action", "consent", "captcha",
                   "redirect", "info", "complete"],
    "idp_types": ["oidc", "saml", "ldap"],
    "delivery_modes": ["dev_inbox", "byo", "managed"],
    "renderer_modes": ["default", "template", "ejected"]
  },
  "warnings": []
}
```

If the client-side config references a step type, IDP type, or delivery mode the server does not support, the response includes structured warnings (or errors for hard incompatibilities). This lets the SDK surface a clear diagnostic: "Your `zitadel.json` uses `captcha` steps, but this Zitadel deployment is on schema version 1.3. Upgrade the Zitadel deployment or remove captcha steps."

For the MVP the handshake is a diagnostic; stricter enforcement (rejecting uploads that mention unknown step types) is a tunable on the server side.

The version-compatibility problem between SDK bundles and server schema versions is what [Gayathri's task](README.md) is centered on. This document names the surface where her work lives; the detailed specification is follow-up work.

## Environment variable references

Values in `zitadel.json` can reference environment variables with `${VAR}` syntax:

```json
{
  "idps": {
    "google": {
      "clientId": "${GOOGLE_CLIENT_ID}",
      "clientSecret": "${GOOGLE_CLIENT_SECRET}"
    }
  }
}
```

The SDK resolves these **client-side, before upload**, using the process environment. Unresolved references cause an upload error with a clear message naming every missing variable.

The setup CLI writes a `.env.example` file on first run, listing every variable referenced by the scaffolded config. Developers copy it to `.env.local` and fill in values. The `.env.example` is committed; the filled-in `.env.local` is not.

For MVP, secret values are resolved client-side and sent to the server over TLS. They are stored encrypted at rest, scoped to `(project_id, environment)`. Post-claim, a server-side secret store is available so that teammates who pull the repo do not each need to hold raw secret values — they fetch per-environment secrets after authenticating. Full secret-store specification is deferred.

## Environments

Every environment carries an `issuer` (or `issuer_pattern`) — the customer-owned origin on which the UI and OIDC endpoints run. This is the single most important field in the configuration surface: it is both the security allowlist and the token/email context.

```json
"environments": {
  "development": { "issuer": "http://localhost:3000" },
  "preview":    { "issuer_pattern": "https://*.vercel.app" },
  "production": { "issuer": ["https://acme.com", "https://app.acme.com"] }
}
```

Each environment may declare:

- **`issuer`** — a single origin (`"https://acme.com"`) or an array of origins (`["https://acme.com", "https://app.acme.com"]`). Use the array form if your production traffic legitimately arrives at multiple hostnames.
- **`issuer_pattern`** — a wildcard pattern (`"https://*.vercel.app"`) for environments where the origin is dynamic. Preview deploys on Vercel / Netlify / Cloudflare Pages are the canonical case. Patterns are restricted to a known safe set (`*.vercel.app`, `*.netlify.app`, `*.pages.dev`, `*.railway.app`, etc.) — arbitrary wildcards are rejected.

Declared issuers serve three purposes simultaneously:

1. **Security allowlist.** The server rejects any browser or origin-scoped API request whose `Origin` header does not match the declared issuer list for the active environment. The match must be exact (or match the pattern). Bearer-secret compromise + an unknown origin is rejected at the edge.
2. **Token issuer context.** The `iss` claim in OIDC tokens is the matched issuer for the request. Third-party OIDC clients (Grafana, etc.) pin to this value.
3. **Email rendering context.** Magic-link URLs in outgoing emails are rendered against the matched issuer. If the user started their flow at `https://acme.com`, the magic link in their email points at `https://acme.com` — not at any other declared origin.

### Environment detection

| Platform | Detection signal |
|---|---|
| Development | No `VERCEL_ENV`, `NETLIFY`, `RAILWAY_ENVIRONMENT`, etc.; `NODE_ENV != 'production'` |
| Preview | `VERCEL_ENV == 'preview'`, `NETLIFY_CONTEXT == 'deploy-preview'`, Railway non-production environments, etc. |
| Production | `VERCEL_ENV == 'production'`, `NETLIFY_CONTEXT == 'production'`, `NODE_ENV == 'production'` with no preview signals |

### Issuer resolution defaults

| Environment | Resolution |
|---|---|
| `development` | Auto-derived from the dev-server origin (`http://localhost:3000` and similar). Explicit declaration overrides. |
| `preview` | Typically declared as `issuer_pattern` because preview URLs are dynamic. The CLI infers a default pattern from detected deploy tooling. |
| `production` | **Must be declared explicitly.** The `npx zitadel push` linter rejects production configs without an explicit `issuer`. Third-party integrations pin to the production issuer; getting it wrong silently breaks downstream consumers. |

The resolved config for an environment is computed by deep-merging the top-level config with `environments[env]`. Arrays replace (do not concatenate); objects merge field-by-field. The merged config is what `npx zitadel push` uploads to the server, keyed by `(project_id, environment)`.

### Multi-tenant white-label is a different problem (deferred)

A B2B customer whose own customers each get their own hostname (`customer-a.auth.com`, `customer-b.auth.com`, …) — with each hostname mapping to a different tenant in the B2B customer's data model — is not served by the `issuer` list pattern. That use case needs a dedicated primitive (a "tenant" or "scope" object) that maps runtime hostnames to logical contexts. Designing that primitive is deferred to **Level 4** — see [Overview — Integration levels](overview.md#integration-levels).

## Proxy endpoints (scaffolded on demand)

The customer's app serves the OIDC and discovery endpoints on its own origin. These routes are **not scaffolded at `npx @zitadel/setup` time** — the initial scaffold is a passkey-only login component on `/login`, which does not need the OIDC routes to exist.

Scaffolding is triggered on either of two signals, both detected by `npx zitadel push`:

1. **An entry appears under `idps.*` in `zitadel.json`.** Federated IDPs need a callback route on the customer's origin for the OAuth / OIDC return leg. Adding `idps.google` (for example) and running `npx zitadel push` prompts the CLI to scaffold the proxy routes if they are not already present.
2. **The server-side "OIDC client" capability is enabled.** OIDC clients (third-party apps that authenticate *against* this Zitadel project — e.g. Grafana, an internal admin tool) are resources, not config — they live in the API / MCP surface (see the [config-vs-resources split](#the-split-config-vs-resources)). When the first client is added via API or MCP, the server records the capability; the next `npx zitadel push` sees the flag and offers to scaffold.

An explicit escape hatch — `npx zitadel proxy add` — lets developers scaffold on demand without either signal, for cases where they want the routes in place before adding an IDP or registering a client.

| Path | Purpose | Default implementation |
|---|---|---|
| `/.well-known/openid-configuration` | OIDC discovery | Generated once at build time; declares issuer = the environment's origin; lists the other paths below |
| `/.well-known/jwks.json` | Token verification keys | Proxies to Zitadel backend |
| `/authorize` | OIDC authorization endpoint | Proxies to Zitadel backend; the auth web component renders on the customer's origin |
| `/token` | Token exchange | Proxies to Zitadel backend |
| `/userinfo` | Claims | Proxies to Zitadel backend |
| `/logout` / end-session | Session termination | Proxies to Zitadel backend; Set-Cookie rewriting scoped to the customer's origin |

Per-framework SDK packages (`@zitadel/sdk-next`, `@zitadel/sdk-remix`, `@zitadel/sdk-astro`, `@zitadel/sdk-express`, …) export `createZitadelProxy()` / `createZitadelHandlers()` helpers so the customer does not hand-write HTTP forwarding. The detailed per-framework scaffold is specified in a follow-up doc.

## `npx zitadel push` — the canonical config sync

`npx zitadel push` is how configuration gets from the repo to the server. There is no ambient "auto-upload on SDK boot" — everything goes through this command.

```
npx zitadel push                         # Push the resolved config for the current environment
npx zitadel push --environment preview   # Force a specific environment
npx zitadel push --dry-run               # Lint + print what would change, don't upload
```

What it does:

1. **Resolves `${VAR}` references** client-side against the process environment.
2. **Runs lint checks** before uploading:
   - Capability referenced in config but not enabled on the project (e.g. SAML SP configured, SAML-SP capability off)
   - Unresolved env var
   - Dangling flow-step reference (step name referenced from a transition that doesn't exist)
   - Declared issuer that does not look reachable (DNS resolution hint, TLD validation)
   - Renderer mode references a file that doesn't exist
3. **Computes a content hash** and skips the upload if it matches the last-applied hash for `(project_id, environment)`.
4. **Uploads the server-behavior subset** (see [What uploads to the server](#what-uploads-to-the-server-what-stays-local)).
5. **Reports capability warnings** from the server's capabilities handshake.

The dev-server hook calls `npx zitadel push` automatically when `zitadel.json` changes during `npm run dev`. Customers can disable the hook if they prefer explicit invocation. CI pipelines always call it explicitly (after tests, before deploy).

Full lint-rule spec is deferred to a follow-up doc.

## Drift

The repo wins. On the next `npx zitadel push`, dashboard edits that diverge from the uploaded config are overwritten silently — same model Vercel uses when a repo push supersedes a dashboard change. No merge UX, no banner, no prompt. If a customer wants dashboard-only config (no GitOps), they remove `zitadel.json` from the repo and operate entirely through the dashboard; the server stops expecting pushes.

## Preview deploys

Preview deploys work before claim via the **preview secret** minted at project creation and handed to the deploy platform's environment store automatically by the setup CLI. The preview secret is origin-scoped to the patterns declared at mint time (`["*.vercel.app"]` and similar). Full specification is in [Project Secret](secret.md#preview-secret-handoff).

On production deployment (non-preview origin, first push to `main` → production hostname), the SDK refuses to start and prints:

```
⚠ Production deploys require a claimed Zitadel project.
  Claim this project now: npx zitadel claim
```

This is the point at which claim becomes unavoidable.

## Project identifiers

Project IDs use the dialect-minted `proj_<opaque>` form ([ADR 047](../../adrs/047-dialect-id-generation.md)): PostgreSQL and SQLite use ULID bodies, while Spanner uses UUID v4. Clients must treat the body as opaque. The earlier curated-dictionary slug scheme is retired. Project IDs appear in dashboard URLs, claim URLs, and scratch-dashboard paths as *identifiers* — never as user-facing origins in the default path.

Subdomain naming rules (phishing-kit string blocks, Levenshtein brand matching, abuse review) apply only when Zitadel mints a real subdomain on the customer's behalf — a Level 2/3 concern. Deferred until those levels ship.

## See also

- [Project Secret](secret.md) — what authenticates config uploads; preview-secret lifecycle
- [Claim Flow](claim-flow.md) — what changes when a project is claimed
- [Config API](api/config-api.yaml) — HTTP surface for config upload + drift
- [Flow Engine](../flowengine/flow-engine.md) — consumer of flow definitions uploaded here
- [User Schema Integration](../flowengine/user-schema.md) — consumer of schemas uploaded here
