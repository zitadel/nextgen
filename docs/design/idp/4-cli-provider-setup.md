# Provider Setup Sub-Journey

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 4 of 4 (see [`README.md`](README.md))

This CLI journey translates developer provider selection (e.g., "Google") into a fully working project configuration.

## Workflow Phases

1. **Surface Callback URI:** Display the exact redirect URI needed for provider console registration.
2. **Capture Credentials:** Collect required authentication credentials (e.g., Client ID and Client Secret).
3. **Scaffold Files:** Generate all required resource definitions.
4. **Preview:** Render a diff preview of planned configuration changes.
5. **Write:** Save changes to the local file system (deployment stays with `plan`/`apply`).

## Integration Points

A single journey unit powers two distinct callers:

* **Initial Setup (`zitadel setup`):** Called during method selection (Area 2 generator integration).
* **Post-claim:** Called from the Sign-in methods journey ([Post-Claim Re-entry](#post-claim-re-entry)).

> **Architecture Note:** The journey writes strictly to the local working tree. Upload belongs to the sync commands (`plan`/`apply` today, `deploy` under ADR 035): ADR 007's split is that repo files describe configuration while server APIs own runtime resources, and this journey stays on the file side of that line.

> **Scope Note:** These two callers are the only setup surfaces this iteration. The Console is read-only: the developer explicitly cannot "configure or manage identity provider connections through the Console in this iteration" (epic, Console experience). There is no API journey either: no IdP CRUD API exists yet (area 1's largest open point; ADR 007 marks resource-like IdP commands experimental until their server contracts are real). When that API lands, ADR 035 keeps direct per-resource CRUD as a first-class write path beside file sync, so an API client writes connections through it rather than through this journey's files.

## Excluded Scope

- **Production Secret Delivery at Token Exchange:** Deferred to Area 1's secret-store specification. The development-runtime join is 851 work ([Exported Requirements](#exported-requirements)).
- **Callback Route Server Implementation:** Handled by Area 3 (Server).

## The Sub-journey

The journey is one more setup prompt. It contributes an `idp` slice to the setup answers during collection and writes nothing itself; setup's existing execution phase writes the files.

### Interactive Prompt Workflow

For each selected provider, the terminal executes the following step-by-step sequence:

```text
◆ Google sign-in needs an OAuth application.
│ Callback URI (development):
│   http://localhost:3000/__nextgen/idp/callback
│ Create the application at https://console.cloud.google.com/apis/credentials
◆ Open the Google console in your browser?  (Y/n)
◆ Client ID:  1234-abc.apps.googleusercontent.com
◆ Client secret (goes to .env.local, Enter to defer):  ********
```

1. **Announce:** What the provider requires, the exact callback URI per environment, and the console URL from the [catalog](#the-provider-catalog).
2. **Offer the Browser:** Opens the console URL, guarded like the claim journey: skipped when non-interactive or when `--no-open` is passed. The prompt then waits while the developer creates the application provider-side.
3. **Reuse or Create:** Evaluates connection handling [below](#create-or-reuse).
4. **Client ID:** Prompts with a text input, checking only that the input is non-empty. Vendor ID formats are treated as vendor knowledge and remain excluded from the CLI.
5. **Client Secret:** Prompts using a masked password input (`@clack/prompts`). An empty input defers capture: the file carries the variable name regardless so the value can arrive out-of-band (see [Credential capture](#credential-capture)).
6. **Summary Row:** Appends an entry to setup's final summary (skipped under `--json`), listing the written files and any pending variable assignments.

>**Note:** Provider-side creation by the developer is forced, not chosen: there is no cross-vendor API for creating OAuth applications (GitHub's classic OAuth Apps expose no creation API; Google's clients are console-managed), and per-vendor automation code is explicitly prohibited by the series' "vendor knowledge is data" rule. The open question is only *when* creation happens, which the epic resolves through journey sequencing: the CLI outputs the exact callback URI so the developer can copy it without manual construction before connecting an existing OAuth application or creating a new one.

### Key Rules

* **Skip vs. Cancel:** Cancel aborts setup. The sub-journey additionally provides a "skip for now" option: the provider is dropped from method selection, no files are scaffolded for it, setup continues uninterrupted, and the final summary says to add it later through the Sign-in methods journey. Scaffolded files are never written with placeholder credentials, ensuring every created connection file passes validation.
### Post-Claim Re-entry

After claim, the same sub-journey runs behind the Sign-in methods journey. The epic's acceptance criteria fix that surface (a Project menu with Configure your Project, Preview and apply changes, Open in Console; a Configure submenu ordered User profiles, Sign-in methods, Login journeys; Sign-in methods opens the onboarding journey). The menu, its routing, and its command spellings are ticket work. What carries over from setup, and what is new:

* **Reuse is the default mode:** an existing connection for the catalog key is reused ([Create or Reuse](#create-or-reuse)); create is the fallback.
* **Schema picker:** with several files under `.zitadel/schemas/`, the journey asks which schema the methods apply to, seeded from that schema's current `x-auth-methods`. A provider selected for a second schema extends the connection's `claim_mapping` by intersection instead of duplicating the connection; this is the path that activates multi-schema reuse.
* **Edits in place:** the generator owns `x-auth-methods` and the flow scaffold delta (`sso_providers` arrays, the `register-sso` and `sso-conflict` steps, the `user_already_exists` retarget, the conflict step's password field and passkey action). It edits an owned region only when its current value equals what the scaffold expects; on any other value it writes nothing and points to manual editing. Removal is the inverse of the scaffold (area 2, [What Each State Means](2-auth-method-selection.md#what-each-state-means)).
* **Working tree, not applied state:** the journey reads and edits the working tree; a file whose hash differs from the last-applied record in `.zitadel/state.json` is shown as having local changes not yet applied. A provider shows as configured when its connection file exists, nothing more; only a completed test run says it works.
* **Skip destination:** a provider skipped during setup is added later through this journey; the setup summary says so.

## Callback URIs

The callback URI follows Area 3's exact specification (`{environment issuer}/__nextgen/idp/callback`), an exact-match path carrying no flow ID. The journey's role is strictly to derive and surface these copyable URIs per environment. The development origin is `http://localhost:{port}` from the setup port, persisted as `environments.development.issuer` in `zitadel.json`; re-entrant runs read it back.

### Multi-Environment Evaluation

The journey iterates over all environment definitions declared in `zitadel.json`, evaluating them by declaration type:

- **Exact Issuers (`issuer`):** Environments declared with an `issuer` property generate one copyable URI per origin. The platform schema types `issuer` as either a string or an array of exact origins ([`configuration-surface.md`, `zitadel.json`](../platform/configuration-surface.md#zitadeljson--the-root)).
- **Pattern Issuers (`issuer_pattern`):** Environments declared with an `issuer_pattern` are explicitly excluded. Because pattern classes cannot produce an enumerable set of exact origins, they fail the exact-match redirect requirements enforced by external providers. The release still deploys there; the engine hides the providers at render ([area 3](3-social-login-flow.md#constraints--edge-cases)). A team that wants to review social sign-in on a deployment declares an exact environment with a fixed domain, which then gets its own row here.

### Default Output Example

```text
development   http://localhost:3000/__nextgen/idp/callback
preview       excluded: declared by issuer_pattern, not an exact issuer
```

### Environment Expansion & Provider Limits

When multi-environment support lands with [#534](https://github.com/zitadel/nextgen/issues/534), the journey will output one row per exact origin (an `issuer` array contributing multiple rows). Provider handling for multiple URIs varies:
* **Google OAuth:** A single client ID accepts multiple registered redirect URIs.
* **GitHub OAuth:** A GitHub OAuth App accepts only a single callback URL, requiring separate OAuth Apps per origin rather than per environment.

*Note:* Whether several URIs mean separate OAuth apps (GitHub) or one app with several redirect URIs (Google) is vendor policy, to be re-verified against live developer consoles prior to shipping. What it means for the credentials is under [Credential Capture](#credential-capture).

## The Provider Catalog

Following Area 1's principle that "vendor knowledge is data," the catalog is a bundled table in `packages/config`. Epic 851 ships with two supported provider entries: `google` and `github`.

### Distribution Strategy

* **Bundled vs. Server-Fetched:** The catalog is bundled statically so the CLI can scaffold resources offline without network dependencies (resolving the open question from [`../cli/identity-surface.md`](../cli/identity-surface.md)). This choice will be re-evaluated if vendor API changes outpace CLI release cadences.

### Catalog Schema

| Field | Purpose & Usage |
| :--- | :--- |
| **Protocol Block**<br>*(endpoints/issuer, pins, scopes, `supplementary_fetch`, `verified_claims` defaults)* | Populates connection files based on Area 1's test-verified examples, injecting the prompted `client_id` and the intersection of the claim table with the active schema (`claim_mapping`). |
| **Claim Table**<br>*(schema property name → provider claim name)* | Authored per provider, like the rest of the catalog entry, not derived: each row pairs one of our property names with the provider's documented claim, cross-checked against zitadel/zitadel's provider packages. At scaffold the rows whose key the active schema defines become the connection's `claim_mapping`. |
| **Display Name & `template`** | Populates `sso_providers` step entries and CLI console output. |
| **Console URL & Docs URL** | Surfaced during the announce step and within error envelopes. |
| **Callback Guidance**<br>*(multi-URI client vs. app-per-environment)* | Surfaced during the announce step to guide developer app registration. |

### Mapping Defaults

The default slug matches the catalog key. For the default schema, `email` is mapped across both providers; use-case properties (`givenName`, `familyName`) are added whenever present in both the target schema and the provider's claim table (GitHub has no `familyName` source, and its `givenName` maps to the full-name `name` claim; see area 1's claim-mapping caveat). Properties the claim table does not know stay unmapped. The setup summary names the schema's required properties that got no mapping, so the tenant can add rows or accept that the collection step asks for them.

## Credential Capture

Credentials are per environment; the connection is not. The connection file carries references: `client_secret_env` is always a variable name, and `client_id` is a `${VAR}` reference when it differs per environment (area 1, [Open Points](1-resource-model.md#open-points)). One revision is promoted unchanged and each environment supplies its own values. Which values differ is vendor policy: a GitHub OAuth App accepts one callback URL, so GitHub needs one app per origin and a `${GITHUB_CLIENT_ID}` per environment; a Google client accepts several redirect URIs, so one literal client id can serve them all.

In 851 the journey captures one client id and one secret, for development, the only environment that exists ([README](README.md#scope-for-851)). Further environments add values, not connection edits, once [#534](https://github.com/zitadel/nextgen/issues/534) defines them, the secret store holds their secrets, and `${VAR}` resolution at the engine makes a reference client id usable.

### Client ID Rules

- **Literal vs. Reference:** Accepts literal strings by default (common single-environment setup) or environment variable references like `${GOOGLE_CLIENT_ID}` (Area 1's syntax for per-environment resolution).
- **Environment Resolution:** Both prompt inputs and flags accept either syntax. Reference values (`${VAR}`) reach the engine unresolved and are evaluated per-environment.
- **Stubbing:** Referenced environment variable names are automatically stubbed into `.env.example`.

### Client Secret Rules

- **Variable Naming:** Derived automatically from the provider slug (uppercase, non-alphanumerics converted to `_`, suffix `_CLIENT_SECRET`, and prefixed with `_` if starting with a digit). Examples: `GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_SECRET`. Reused connections keep their existing `client_secret_env` name intact.
- **File Actions:**
  - Writes `client_secret_env` into the connection file.
  - Stubs the variable name into `.env.example` via `merge-env`.
  - Writes the secret value into `.env.local`.

#### Safety & Security Gates

* **Gitignore Safety Gate:** Secret values are written to `.env.local` only if verified as untracked and gitignored via `git check-ignore`. If verification fails, only the stub is written and manual setup instructions are printed.
* **CLI Safety:** Secret values are never exposed in process arguments (`argv`); no `--client-secret` flag exists.
* **No-Clobber Behavior:** `merge-env` will not overwrite existing keys. Re-running with a new secret prompts: *"already set in `.env.local`, edit it there"*.
* **Deferred Capture:** Empty prompt inputs defer value entry, allowing developers to manage secret values out-of-band.

## Missing Credentials

Missing credentials fall into two distinct execution states:

### Missing Client ID (Capture-Time)
- **Interactive:** The prompt pauses and waits for user input.
- **Non-Interactive:** Fails immediately with an error before writing resources when a create is required; a scan match needs no client id and follows the reuse rule ([Create or Reuse](#create-or-reuse)).
- **Environment Reference:** Passing a `${VAR}` reference defers evaluation to plan-time presence checks via `E_CREDENTIAL_MISSING`.

### Missing Secret Value (Plan/Apply-Time)
- **Error Code `E_CREDENTIAL_MISSING`:** Dedicated error code distinguishing missing values (acquire credential locally) from `E_VALIDATION` (edit the file).
- **Diagnostics:** The error envelope `hint` specifies the variable name and `.env.local`, directing users to re-run `plan`.

## Create or Reuse

The setup sub-journey connects existing OAuth applications or creates new ones without duplicating connections across re-runs.

### Scan & Match Logic

* **Identity-Based Scan:** Scans `.zitadel/idps/*.json` matching on `template` (equal to catalog key) or protocol block endpoints (`issuer` equal to `https://accounts.google.com` or `authorization_endpoint` equal to `https://github.com/login/oauth/authorize`). Endpoints take precedence if `template` conflicts.
* **Single Hit (Reuse):** Displays slug and `client_id` for interactive confirmation; non-interactive executions auto-reuse when no client id was supplied (reuse writes no new resource, so the Missing Client ID rule does not engage) or when the supplied id matches the stored `client_id`; a mismatch fails with `E_VALIDATION` naming both ids, never silently keeping the existing app. Extends the connection's `claim_mapping` to cover the active schema using superset semantics, without modifying existing secrets. Re-checks credential presence so missing local values yield `E_CREDENTIAL_MISSING` with a `.env.local` pointer.
* **Multiple Hits:** Prompts interactive user selection; throws a non-interactive error listing matching candidates.
* **No Hit (Create):** Scaffolds at catalog slug. If slug or filename collides with an unmatched connection, prompts for a new slug or throws `E_CONFLICT` using atomic file writes (`wx`). `--force` is explicitly ignored for connection files to prevent destructive overwrites of hand-authored resources.
* **Idempotency:** Re-running with unchanged inputs is a complete no-op end-to-end, producing identical state hashes with zero reported plan changes.

## Scaffolded Artifacts

Selecting `google` on the default scaffold touches the following target files:

| Artifact | Change |
| :--- | :--- |
| **`.zitadel/idps/google.json`** | New connection file containing the captured `client_id`. |
| **`.zitadel/meta/idp-connection.json`** | Local copy of the meta-schema. |
| **`.zitadel/schemas/default-human-user.json`** | Sets `x-auth-methods.sso: { "enabled": true, "providers": ["google"] }`. |
| **`.zitadel/flows/default-login.json`** | The SSO routing delta below. |
| **`.env.example`, `.env.local`** | Variable stub and local secret value. |
| **`.zitadel/state.json`** | Connection state entry. |

The flow topology rests on five decisions:

### Flow Architecture Decisions

#### 1. Shared Entry for Login and Registration
The shipped default configuration (`packages/config/defaults/default-login.json`) handles both login and registration within a single definition. By attaching `sso_providers` to both entry steps, we satisfy Area 3's purpose-independent outcome mapping. This prevents unnecessary definition forks and resolves the register-step topology [open point from Area 2](2-auth-method-selection.md#open-points).

#### 2. The Three-Outcome Rule for SSO Steps
Every step carrying `sso_providers` must explicitly handle three outcomes: `callback`, `identity_unknown`, and `user_already_exists`. The first two are SSO-only routes; `user_already_exists` is shared with typed collisions, which is what decision 5 is about.
*   **`identity_unknown` → `register-sso`** on every step, so an unknown user reaches the collection step after one ceremony whether they started on the sign-in or the register page ([area 3](3-social-login-flow.md#resolution-branches)). The engine flips `CurrentPurpose` to `register` on the way.
*   **`user_not_found` is untouched.** It stays the typed-email outcome with the shipped default's target, `identifier.user_not_found → register`. The scaffold adds no `user_not_found` to `register`: after the bounce that step runs under register purpose, where typed input can only fire `user_already_exists` ([`capabilities.md`](../flowengine/capabilities.md#steps--state-machine)).

#### 3. The SSO Collection Step (`register-sso`)
Modeled after `register-password`, this step finalizes external identity provisioning.
*   **Fields:** Renders schema fields from the register entry (defaulting to `email` plus any active use-case properties).
*   **Execution:** Pre-fills values from mapped IdP claims and enforces completion for empty required fields. If a user modifies a pre-filled value, its verification status is dropped.
*   **Action:** Executes `on_success: "create_user_with_sso"` upon submission to consume the identity.
*   **Collision Routing:** If a modified field causes a collision upon submission, `user_already_exists` routes the user to `sso-conflict`.

#### 4. The Unified Conflict Step (`sso-conflict`)
This is a comprehensive recovery step presented under "account exists" messaging. Because the system cannot know which methods the colliding account possesses, it offers every method the schema enables: the password field, the passkey action, and the SSO provider buttons (the scaffold shows all three because the shipped default enables them; they follow the method set, and the post-claim journey keeps them in step, [Post-Claim Re-entry](#post-claim-re-entry)). The engine binds the attempt to the colliding account.
*   **SSO Outcomes:** Carrying `sso_providers` puts the step under the three-outcome rule:
    *   `callback` routes to `done`: the user signed in with a provider already linked to that account.
    *   `user_already_exists` targets the step itself: clicking the colliding provider again re-runs the ceremony and resolves identically, so the step re-renders with the same options. The copy is written to be seen more than once.
    *   `identity_unknown` routes to `register-sso`: reachable only if the provider returns a different, unknown subject (the user switched provider accounts mid-loop).
    *   A wrong password re-renders the step with an error and no transition ([`capabilities.md`](../flowengine/capabilities.md#steps--state-machine)); `user_already_exists` comes from identifier resolution, never from the password field.
*   **Navigation Fallback:** Includes a secondary `sign_in` action targeting `identifier` (`{ "target": "identifier", "purpose": "login" }`) so the user can back out and use a different account.
*   **Transition Logic:** Standard in-definition navigation is used. If a tenant separates login and register into distinct definitions, the transition updates to `"action": "switch"` targeting the login definition (dropping `purpose`). The `pivot` action is never scaffolded.

#### 5. Retargeting Registration Collisions
The `register.user_already_exists` outcome is retargeted from the `password` step to the new `sso-conflict` step.
*   **The Rationale:** A colliding account might be SSO-only. Routing directly to `password` fails if the user has no password or passkey configured.
*   **The Benefit:** Because `sso-conflict` offers all methods, a typed-email user with a password still recovers in one step, preserving the efficiency of the shipped default.
*   **State Preservation:** The fallback routing back to `identifier` preserves input field values across step boundaries ([`capabilities.md`](../flowengine/capabilities.md#steps--state-machine)).

#### Identity Lifecycle

- **Identity Lifetime Boundary:** Area 3 keeps the resolved external identity "an ephemeral object attached directly to the attempt that dies when the attempt completes or expires". The scaffold never persists it, so crossing the conflict step boundary means the sign-in path re-runs the provider ceremony rather than reusing a resolved identity.

The complete target, the shipped default plus `google`; diff it against `packages/config/defaults/default-login.json` for the delta: [`schemas/default-login.scaffold.json`](schemas/default-login.scaffold.json).

* **Enum Extension:** The shipped `on_success` enum in `flow-definition.json` (`$defs.Step`) currently contains `["create_user"]`. Scaffolding requires adding `create_user_with_sso` (the handler specified in Area 3). Adding this enum value only widens acceptance, non-breaking per the same principle Area 1's forward-compatibility table documents for connection files. The scaffold's locale keys are listed under [Exported Requirements](#exported-requirements).

## Preview and Apply

The epic requires connection configurations to be visible in the plan preview while explicitly separating application from verification: applying changes is never presented as proof that sign-in works.

* **Mutable, not revisioned:** the connection id is stable and the server revises under it (`PUT /idps/{id}`), so a hash change is an update, never a new outer id. No re-pin of references on change; slug references make it structurally unnecessary anyway.
* **Validation before upload:** the syncer runs the meta-schema and the validator rules from areas 1 and 2, with the [`E_CREDENTIAL_MISSING`](#missing-credentials) split for unresolved env refs.
* **Secret-free previews:** previews display only the variable name (`client_secret_env`). Update previews show a field diff once a read endpoint exists.
* **Delete:** a local file delete schedules a platform delete; what the server does with it is the open deletion question (area 1, Open Points).
* **CRUD dependency:** create and update depend on the IdP CRUD API landing. Until it exists, file generation, validation, and `plan` previews function independently.
* **Verification Separation:** final summaries and `next_commands` hand off to the test sign-in command (ticket work). Status copy uses "applied" and never claims sign-in is "working".

## Non-interactive Contract

In non-interactive mode (triggered by non-TTY `stdin`/`stdout` or explicit `--json` flags), CLI flags supply setup answers. Method selection flags belong to Area 2's surface area.

### Client ID Flags

* **Flag Syntax:** Provider-specific flags (e.g., `--google-client-id`, `--github-client-id`) skip the interactive prompts.
* **Value Types:** Flags accept either literal strings or environment variable references (e.g., `'${GOOGLE_CLIENT_ID}'`). Passing a variable reference defers presence validation to `plan`.

### Missing Client ID Validation

If a selected provider is specified without a Client ID, setup halts prior to resource generation (create path; a reuse match needs no client id, see [Create or Reuse](#create-or-reuse)). The `E_VALIDATION` envelope carries the guidance normally shown in interactive mode: the console URL and callback URI in `hint`, the flag to pass in `next_commands`.

* **No Secret Flag:** Secrets cannot be passed via CLI flags. Deferred capture is the default non-interactive behavior, allowing scaffolding to proceed normally.
* **Missing Secret Handling:** If the secret is absent from `process.env` and local environment files (`.env.local`, `.env`), the output envelope includes a warning naming the missing variable alongside remediation steps in `data.next_actions`.
* **Structured Payload (`data.idps`):** Mirrors the interactive announce step per provider: slug, template, callback URI per environment, excluded environments with the declaration kind as reason, console URL, `client_secret_env`, and whether the secret is present. Exclusions are structured so agents can tell a declaration-level exclusion from an unconfigured environment without parsing terminal text.

## Exported Requirements

| Requirement | Detail | Owed By / Target Area |
| :--- | :--- | :--- |
| **Re-enterable Sub-Journey** | Callable behind the "Sign-in methods" interface with the reuse branch as default mode. | Sign-in methods journey (ticket work, [Post-Claim Re-entry](#post-claim-re-entry)) |
| **Test Journey Handoff** | Provides execution target for exit copy; applying changes is never presented as working sign-in. | Test sign-in command (ticket work) |
| **Validation Rule** | Enforces that steps with `on_success: create_user_with_sso` route `user_already_exists`. | Validator Work (Area 2) |
| **Multi-Schema Reuse** | Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the post-claim schema picker. | Sign-in methods journey (ticket work, [Post-Claim Re-entry](#post-claim-re-entry)) |
| **"Skip for now" Destination** | The setup sub-journey's skip path hands the dropped provider to the Sign-in methods journey; the final summary names it. | Sign-in methods journey (ticket work) |
| **Locale Keys** | `register-sso.action.submit`, `sso-conflict.action.submit`, `sso-conflict.action.passkey`, `sso-conflict.action.sign_in`; step titles derive from step names. | Login UI / Locale Work |
| **Error Codes** | `E_CREDENTIAL_MISSING` (acquire a value locally, distinct from `E_VALIDATION`: edit the file) and `E_CANCELLED` (a cancellation signal distinct from `E_VALIDATION`, required by a menu loop that returns to its parent on cancel). | CLI error union |
| **Dev-Runtime Secret Join** | At local-runtime spawn the CLI resolves the connection's declared env refs from `.env.local` and injects them into the engine process environment, so the engine's name-to-value join works at token exchange. Development only, downstream of everything diffed or printed. Production delivery stays with area 1's deferred secret-store spec. | CLI local runtime |
| **`create_user_with_sso`** | Meta-schema enum value plus the engine handler from area 3. | Flow meta-schema / Engine |
| **`identity_unknown`** | New reserved outcome, fired by ceremony resolution for an unknown subject; joins the reserved-key list in the `transitions` description, the validator's three-outcome rule, and ADR 017's flip table (`login` → `register`). | Flow meta-schema / Engine / Validator |

## Open Points

* **Flag Spelling & Multi-Select Wiring:** Settles `--auth-methods` and per-provider flag names with Area 2 generator recomposition, fixing the contract (Client IDs supplied by flag, secrets strictly excluded from argv).
* **Prefilled Console Deep-Links:** Evaluating prefilled query params (name, homepage, callback URL) for provider consoles (supported by GitHub, unsupported by Google).
* **`issuer_pattern` Shape Reconciliation:** The CLI seeds `issuer_pattern` as an array holding the exact development origin while the platform contract types it as a wildcard string and puts exact origins under `issuer`; pending reconciliation the journey excludes by declaration kind and prints that as the reason ([`configuration-surface.md`, `zitadel.json`](../platform/configuration-surface.md#zitadeljson--the-root); [`configuration-surface.md`, Environments](../platform/configuration-surface.md#environments)).
* **`scaffoldedFrom` Provenance:** Pending Area 1's specification for recording provenance data on generated connection resources.
* **Multi-Schema Connection Reuse:** Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the post-claim schema picker ([Post-Claim Re-entry](#post-claim-re-entry)).
* **Secret Rotation UX:** Defining explicit rotation workflows beyond existing no-clobber behavior in `.env.local` (deferred to Area 1 secret-store spec).

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: connection shape, catalog rationale, lifecycle, secrets)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2: schema shape, validator rules)
- [`3-social-login-flow.md`](3-social-login-flow.md) (area 3: ceremony, outcomes, conflict route)
- [`../cli/identity-surface.md`](../cli/identity-surface.md) (earlier draft: `E_CREDENTIAL_MISSING`, `.env.example` stubbing, preset catalog)
- `packages/config/defaults/default-login.json` (the base the flow scaffold extends)
