# Provider Setup Sub-Journey

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 4 of 9 (see [`README.md`](README.md))

This CLI journey translates developer provider selection (e.g., "Google") into a fully working project configuration.

## Workflow Phases

1. **Surface Callback URI:** Display the exact redirect URI needed for provider console registration.
2. **Capture Credentials:** Collect required authentication credentials (e.g., Client ID and Client Secret).
3. **Scaffold Files:** Generate all required resource definitions.
4. **Preview:** Render a diff preview of planned configuration changes.
5. **Apply:** Write changes directly to the local file system.

## Integration Points

A single journey unit powers two distinct callers:

* **Initial Setup (`zitadel setup`):** Called during method selection (Area 2 generator integration).
* **Management Menu:** Called post-claim from the "Sign-in methods" interface (Area 5).

> **Architecture Note:** The journey writes strictly to the local working tree. Upload belongs to the sync commands (`plan`/`apply` today, `deploy` under ADR 035): ADR 007's split is that repo files describe configuration while server APIs own runtime resources, and this journey stays on the file side of that line.

> **Scope Note:** These two callers are the only setup surfaces this iteration. The Console is read-only: the developer explicitly cannot "configure or manage identity provider connections through the Console in this iteration" (epic, Console experience; the read-only views are Area 7). There is no API journey either: no IdP CRUD API exists yet (area 1's largest open point; ADR 007 marks resource-like IdP commands experimental until their server contracts are real). When that API lands, ADR 035 keeps direct per-resource CRUD as a first-class write path beside file sync, so an API client writes connections through it rather than through this journey's files.

## Imported Requirements

What [`3-social-login-flow.md`](3-social-login-flow.md#exported-requirements) and [`2-auth-method-selection.md`](2-auth-method-selection.md#open-points) expect this area to answer:

- [x] **Callback URI Surface:** Expose `{origin}/__nextgen/idp/callback` in the setup journey and per environment. Answered in [Callback URIs](#callback-uris).
- [x] **Flow Scaffolding:** Scaffold `sso_providers` on register-purpose steps and the conflict step with its login route. Answered in [Flow architecture decisions](#flow-architecture-decisions). In the shipped single-definition default, this routes as an in-definition navigation rather than a `switch` (mirrored in Area 3's navigation mechanics).
- [x] **Register-Step Topology:** Settled in favor of a shared entry step, resolving Area 2's open point that "both single-step and multi-step topologies are functionally valid. The final choice was a CLI scaffolding decision" ([Flow architecture decisions](#flow-architecture-decisions)).

### Excluded Scope

- **Secret Values at Token Exchange:** Deferred to Area 1's secret-store specification.
- **Callback Route Server Implementation:** Handled by Area 3 (Server).

> **Note on Proxy Scope:** The CLI journey surfaces and captures configurations but never resolves secrets or serves routes directly. The framework matcher is already prefix-wide (`/__nextgen/:path*`, defined in `lib/orca/patchers/rule/next/index.ts:32`), meaning no new proxy patcher is required; only the server-side route implementation remains outstanding.

## The Sub-journey

The setup process strictly separates a prompt collection from file execution:

* **Collection Phase:** The prompt loop collects user inputs (`apps/cli/src/commands/setup/index.ts:227-242`).
* **Execution Phase:** `materializeSetupResources` (`index.ts:320`) and the framework patcher (`index.ts:308`) write all changes to disk.

The sub-journey maintains this separation by introducing a new `SetupPrompt` class registered directly after the sign-in method slot in `SETUP_PROMPTS` (`prompts/index.ts`). It contributes an `idp` slice to `SetupAnswers` (`prompts/types.ts:15-30`), riding the existing write phases.

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
2. **Offer the Browser:** Invokes `openInBrowser` (`apps/cli/src/lib/browser.ts:71`), guarded identically to the claim journey (`commands/claim.ts:162`): skipped when non-interactive or when `--no-open` is passed. The terminal prompt then waits while application creation occurs provider-side at the developer's pace.
3. **Reuse or Create:** Evaluates connection handling [below](#create-or-reuse).
4. **Client ID:** Prompts with a text input, checking only that the input is non-empty. Vendor ID formats are treated as vendor knowledge and remain excluded from the CLI.
5. **Client Secret:** Prompts using a masked password input (`@clack/prompts`). An empty input defers capture: the file carries the variable name regardless so the value can arrive out-of-band (see [Credential capture](#credential-capture)).
6. **Summary Row:** Appends an entry to setup's final summary (`buildSummary` in `setup/index.ts:768`, rendered by `summary.ts`, skipped under `--json`), detailing the written files and any pending variable assignments.

>**Note:** Provider-side creation by the developer is forced, not chosen: there is no cross-vendor API for creating OAuth applications (GitHub's classic OAuth Apps expose no creation API; Google's clients are console-managed), and per-vendor automation code is explicitly prohibited by the series' "vendor knowledge is data" rule. The open question is only *when* creation happens, which the epic resolves through journey sequencing: the CLI outputs the exact callback URI so the developer can copy it without manual construction before connecting an existing OAuth application or creating a new one.

### Key Rules

* **Skip vs. Cancel:** Clack's cancel action aborts setup (`prompts/cancel.ts` throws `E_VALIDATION`). The sub-journey additionally provides a "skip for now" option: the provider is dropped from method selection, no files are scaffolded for it, setup continues uninterrupted, and the final summary outputs instructions on adding it later via the Area 5 menu. Scaffolded files are never written with placeholder credentials, ensuring every created connection file passes validation.
* **URI Derivation Order:** Prompt execution order guarantees the URI is derivable when needed: `DevPortPrompt` runs prior to the sign-in method slot (`prompts/index.ts:31-38`), ensuring the development origin is already present in `SetupAnswers`.

## Callback URIs

The callback URI follows Area 3's exact specification (`{environment issuer}/__nextgen/idp/callback`), an exact-match path carrying no flow ID. The journey's role is strictly to derive and surface these copyable URIs per environment.

### Derivation Mechanics

- **Development Origin:** Computed via `issuerFromPort(devPort)` to generate `http://localhost:{port}` (`apps/cli/src/lib/orca/detectors/port.ts:111-113`).
- **Persistence:** Saved in `zitadel.json` under `environments.development.issuer` (`lib/orca/patchers/rule/base.ts:317`).
- **Re-entrancy:** Re-entrant invocations read the existing origin using `readDevelopmentIssuer` (`lib/project.ts:180`).
- **URI Construction:** The full callback URI is formed by appending the fixed path (`/__nextgen/idp/callback`) directly to the derived issuer origin.

### Multi-Environment Evaluation

The journey iterates over all environment definitions declared in `zitadel.json`, evaluating them by declaration type:

- **Exact Issuers (`issuer`):** Environments declared with an `issuer` property generate one copyable URI per origin. The platform schema types `issuer` as either a string or an array of exact origins (`../platform/configuration-surface.md:144`).
- **Pattern Issuers (`issuer_pattern`):** Environments declared with an `issuer_pattern` are explicitly excluded. Because pattern classes cannot produce an enumerable set of exact origins, they fail the exact-match redirect requirements enforced by external providers.

### Default Output Example

```text
development   http://localhost:3000/__nextgen/idp/callback
preview       excluded: declared by issuer_pattern, not an exact issuer
```

### Environment URI Resolution & Constraints

**Preview Shape Divergence**
A structural divergence exists between the platform contract and CLI implementations:
* **Platform Contract:** Types `issuer_pattern` as a wildcard string (e.g., `"https://*.vercel.app"`, see `../platform/configuration-surface.md:326`) and places exact-origin arrays under `issuer`.
* **CLI Implementation:** Seeds `issuer_pattern` as an array containing a single exact development origin (`setup/index.ts:636` via `base.ts:317-323`).

Under the platform specification, exact origins belong in `preview.issuer` (which would render preview environments includable). Pending full reconciliation, the journey excludes environments based strictly on declaration kind (`issuer_pattern`), printing the declaration type as the reason rather than evaluating its contents.

**Environment Expansion & Provider Limits**
When multi-environment support lands with [#534](https://github.com/zitadel/nextgen/issues/534), the journey will output one row per exact origin (an `issuer` array contributing multiple rows). Provider handling for multiple URIs varies:
* **Google OAuth:** A single client ID accepts multiple registered redirect URIs.
* **GitHub OAuth:** A GitHub OAuth App accepts only a single callback URL, requiring separate OAuth Apps per origin rather than per environment.

*Note:* Area 1 assumes only that `client_id` values differ between environments (the motivation for `${VAR}` references); whether that means separate OAuth apps (GitHub) or one app with several redirect URIs (Google) is vendor policy. These provider capabilities must be re-verified against live developer consoles prior to shipping.

**Copyable Output Mechanics**: To ensure reliability across interactive and automated environments:
* **Terminal Display:** Printed verbatim on standalone lines for direct terminal copying.
* **JSON Envelope:** Structured cleanly inside the JSON output payload under `data.idps[].callback_uris` and `excluded_environments` (per the [non-interactive contract](#non-interactive-contract)), eliminating the need for automated agents to parse formatted terminal text.

## The Provider Catalog

Following Area 1's principle that "vendor knowledge is data," the catalog is implemented as a bundled table in `packages/config` alongside preset templates (`packages/config/src/defaults.ts:44-53`). Epic 851 ships with two supported provider entries: `google` and `github`.

### Distribution Strategy

* **Bundled vs. Server-Fetched:** The catalog is bundled statically so the CLI can scaffold resources offline without network dependencies (resolving the open question from [`../cli/identity-surface.md`](../cli/identity-surface.md)). This choice will be re-evaluated if vendor API changes outpace CLI release cadences.

### Catalog Schema

| Field | Purpose & Usage |
| :--- | :--- |
| **Protocol Block**<br>*(endpoints/issuer, pins, scopes, `supplementary_fetch`, `verified_claims` recipe)* | Populates connection files based on Area 1's test-verified examples, injecting the prompted `client_id` and the intersection of the claim recipe with the active schema (`claim_mapping`). |
| **Claim Recipe**<br>*(schema property concept → provider claim name)* | Drives `claim_mapping` generation by intersecting recipe mappings with schema properties, ensuring the generator only emits mapping targets relevant to the selected use case. |
| **Display Name & `template`** | Populates `sso_providers` step entries and CLI console output. |
| **Console URL & Docs URL** | Surfaced during the announce step and within error envelopes. |
| **Callback Guidance**<br>*(multi-URI client vs. app-per-environment)* | Surfaced during the announce step to guide developer app registration. |

### Mapping Defaults

The default slug matches the catalog key. For the default schema, `email` is mapped across both providers; use-case properties (`givenName`, `familyName`) are added per the recipe whenever present in both the target schema and the provider recipe (GitHub has no `familyName` source, and its `givenName` maps to the full-name `name` claim; see area 1's claim-mapping caveat).

## Credential Capture

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
- **Non-Interactive:** Fails immediately with an error before writing resources.
- **Environment Reference:** Passing a `${VAR}` reference defers evaluation to plan-time presence checks via `E_CREDENTIAL_MISSING`.

### Missing Secret Value (Plan/Apply-Time)
- **Error Code `E_CREDENTIAL_MISSING`:** Dedicated error code distinguishing missing values (acquire credential locally) from `E_VALIDATION` (edit the file).
- **Diagnostics:** The error envelope `hint` specifies the variable name and `.env.local`, directing users to re-run `plan`.

### Environment Resolution

- **File Inspection Order:** Presence checks inspect `process.env`, followed by project-level `.env.local` and `.env` files (the env-file order matching `port.ts:33`). Values are checked for presence only and are never logged or uploaded.
- **Doctor Tooling:** Updates `commands/doctor/checks/env-example.ts` to dynamically include resource-declared environment references alongside hardcoded checks.

## Create or Reuse

The setup sub-journey connects existing OAuth applications or creates new ones without duplicating connections across re-runs.

### Scan & Match Logic

* **Identity-Based Scan:** Scans `.zitadel/idps/*.json` matching on `template` (equal to catalog key) or protocol block endpoints (`issuer` equal to `https://accounts.google.com` or `authorization_endpoint` equal to `https://github.com/login/oauth/authorize`). Endpoints take precedence if `template` conflicts.
* **Single Hit (Reuse):** Displays slug and `client_id` for interactive confirmation; non-interactive executions auto-reuse. Extends the connection's `claim_mapping` to cover the active schema using superset semantics, without modifying existing secrets. Re-checks credential presence so missing local values yield `E_CREDENTIAL_MISSING` with a `.env.local` pointer.
* **Multiple Hits:** Prompts interactive user selection; throws a non-interactive error listing matching candidates.
* **No Hit (Create):** Scaffolds at catalog slug. If slug or filename collides with an unmatched connection, prompts for a new slug or throws `E_CONFLICT` using atomic file writes (`wx`). `--force` is explicitly ignored for connection files to prevent destructive overwrites of hand-authored resources.
* **Idempotency:** Re-running with unchanged inputs is a complete no-op end-to-end, producing identical state hashes with zero reported plan changes.

## Scaffolded Artifacts

Selecting `google` on the default scaffold touches the following target files:

| Artifact | Change Description | Deployment Location |
| :--- | :--- | :--- |
| **`.zitadel/idps/google.json`** | New connection file containing captured `client_id`. | `materializeSetupResources` block alongside schema and flow definitions (`setup-resources.ts:59-222`). |
| **`.zitadel/meta/idp-connection.json`** | Local copy of the meta-schema. | `metaSchemaFiles()` entry (`packages/config/src/meta-schemas.ts:56-66`), copied via patcher (`base.ts:269-276`). |
| **`.zitadel/schemas/default-human-user.json`** | Sets `x-auth-methods.sso: { "enabled": true, "providers": ["google"] }`. | Generator recomposition (Area 2 work). |
| **`.zitadel/flows/default-login.json`** | Applies flow updates for SSO routing. | Generator recomposition (Area 2 work). |
| **`.env.example`, `.env.local`** | Adds variable stub and local secret value. | Executed via `merge-env` patcher operations. |
| **`.zitadel/state.json`** | Updates connection state entry. | Handled by syncer execution loop. |

The flow topology is built on five key design decisions, followed by runtime execution mechanics:

### Flow Architecture Decisions

1. **Shared Entry:** The shipped default serves both login and registration in a single definition (`packages/config/defaults/default-login.json`). The scaffold attaches `sso_providers` to both entry steps, satisfying Area 3's purpose-independent outcome mapping without forcing definition forks or unnecessary churn (resolving Area 2's open point).
2. **Three Outcomes per SSO Step:** Each step carrying `sso_providers` explicitly handles all three required Area 3 outcomes (`callback`, `user_not_found`, and `user_already_exists`):
   - **`identifier` step:** `user_not_found` targets `register` (acting as the offer-register step). `callback` and `user_already_exists` are SSO-only keys on this step.
   - **`register` step:** Typed resolution triggers `user_not_found` under login dispatch and `user_already_exists` under register dispatch. The engine flips `CurrentPurpose` on the `identifier` bounce (`../flowengine/capabilities.md:43`), making `register.user_not_found` SSO-only.
3. **Collection Step (`register-sso`):** Modeled after `register-password`:
   - **Fields:** Renders the schema fields from the register entry (default: `email` plus active use-case properties; the scaffold below shows the minimal schema, so its steps carry `email` only).
   - **Execution:** Prefills values from mapped claims, enforces completion of empty required fields, and drops verification if prefilled values are modified.
   - **Action:** Runs `on_success: "create_user_with_sso"` to consume the resolved external identity.
   - **Collision Route:** Routes `user_already_exists` to `sso-conflict` if modified field values collide upon submission.
4. **Conflict Step (`sso-conflict`):** Contains no input fields and presents a single primary sign-in action (`{ "target": "identifier", "purpose": "login" }`), formatted for repeated exposure during deterministic conflict loops.
   - **`switch` vs. `pivot` Reconciliation:** `switch` and `pivot` target *other* flow definitions (`packages/config/meta-schemas/flow-definition.json`, `$defs.Transition`). In single-definition defaults, standard in-definition navigation is used with no return stack. If a tenant separates login and register into distinct definitions, the transition updates to set `"action": "switch"` and targets the login definition (dropping `purpose`). `pivot` is never scaffolded.
5. **Retargeting `register.user_already_exists`:** Retargeted from `password` to `sso-conflict`. Shared by typed-email and SSO collisions, this prevents dropping SSO users onto a password step without context. Sign-in routes back to `identifier` with input field values preserved across step boundaries (`../flowengine/capabilities.md:47`).

#### UX Trade-offs & Identity Lifecycle

- **Double-Redirect on Login Sign-Up:** `identifier.user_not_found` retains its target (`register`) so typed-email users are not routed into `create_user_with_sso`. An unknown SSO user starting on the sign-in page lands on `register` (email prefilled) and clicks the provider button a second time to reach `register-sso`. Register-entry sign-ups require only one ceremony.
- **Identity Lifetime Boundary:** Area 3 keeps the resolved external identity "an ephemeral object attached directly to the attempt that dies when the attempt completes or expires". The scaffold never persists it, so crossing the conflict step boundary means the sign-in path re-runs the provider ceremony rather than reusing a resolved identity.

<details open>
<summary><code>.zitadel/flows/default-login.json</code> - the complete target, the shipped default plus <code>google</code></summary>

```jsonc
// .zitadel/flows/default-login.json (scaffold target: shipped default plus google)
{
  "$schema": "../meta/flow-definition.json",
  "name": "default-login",
  "status": "active",
  "user_schema": "${USER_SCHEMA_URL}",
  "purposes": {
    "login": "identifier",
    "register": "register"
  },
  "steps": [
    {
      "name": "identifier",
      "fields": ["email"],
      "actions": [
        { "name": "submit", "kind": "submit", "primary": true, "text_key": "identifier.action.continue" },
        { "name": "passkey", "kind": "passkey", "primary": false, "text_key": "identifier.action.passkey" },
        { "name": "register", "kind": "navigate", "primary": false, "text_key": "identifier.action.register.link" }
      ],
      "sso_providers": [
        { "id": "google", "name": "Google", "template": "google" } /* added */
      ],
      "transitions": {
        "submit": { "target": "password" },
        "passkey": { "target": "done" },
        "user_not_found": { "target": "register" },
        "register": { "target": "register", "purpose": "register" },
        "callback": { "target": "done" }, /* added */
        "user_already_exists": { "target": "sso-conflict" } /* added */
      }
    },
    {
      "name": "password",
      "fields": ["x-auth-methods#password"],
      "actions": [
        { "name": "submit", "kind": "submit", "primary": true, "text_key": "password.action.signin" },
        { "name": "passkey", "kind": "passkey", "primary": false, "text_key": "password.action.passkey" }
      ],
      "transitions": {
        "submit": { "target": "done" },
        "passkey": { "target": "done" }
      }
    },
    {
      "name": "register",
      "fields": ["email"],
      "actions": [
        { "name": "submit", "kind": "submit", "primary": true, "text_key": "register.action.password" },
        { "name": "passkey_register", "kind": "passkey_register", "primary": false, "text_key": "register.action.passkey" },
        { "name": "sign_in", "kind": "navigate", "primary": false, "text_key": "register.action.sign_in.link" }
      ],
      "sso_providers": [
        { "id": "google", "name": "Google", "template": "google" } /* added */
      ],
      "transitions": {
        "submit": { "target": "register-password" },
        "passkey_register": { "target": "done" },
        "sign_in": { "target": "identifier", "purpose": "login" },
        "callback": { "target": "done" }, /* added */
        "user_not_found": { "target": "register-sso" }, /* added */
        "user_already_exists": { "target": "sso-conflict" } /* was "password" */
      }
    },
    {
      "name": "register-password",
      "fields": ["x-auth-methods#password"],
      "actions": [
        { "name": "submit", "kind": "submit", "primary": true, "text_key": "register-password.action.submit" }
      ],
      "on_success": "create_user",
      "transitions": {
        "submit": { "target": "done" },
        "user_already_exists": { "target": "password" }
      }
    },
    {
      "name": "register-sso", /* added step */
      "fields": ["email"],
      "actions": [
        { "name": "submit", "kind": "submit", "primary": true, "text_key": "register-sso.action.submit" }
      ],
      "on_success": "create_user_with_sso",
      "transitions": {
        "submit": { "target": "done" },
        "user_already_exists": { "target": "sso-conflict" }
      }
    },
    {
      "name": "sso-conflict", /* added step */
      "actions": [
        { "name": "sign_in", "kind": "navigate", "primary": true, "text_key": "sso-conflict.action.sign_in" }
      ],
      "transitions": {
        "sign_in": { "target": "identifier", "purpose": "login" }
      }
    },
    {
      "name": "done",
      "complete": "show"
    }
  ]
}
```

</details>

* **Enum Extension:** The shipped `on_success` enum in `flow-definition.json` (`$defs.Step`) currently contains `["create_user"]`. Scaffolding requires adding `create_user_with_sso` (the handler specified in Area 3). Adding this enum value only widens acceptance, non-breaking per the same principle Area 1's forward-compatibility table documents for connection files.
* **Validation Suite:** Verified via [`packages/config/src/idp-design-docs.test.ts`](../../../packages/config/src/idp-design-docs.test.ts). The scaffolded block validates against the flow meta-schema once `create_user_with_sso` joins the enum:
    - Every `sso_providers` step explicitly routes all three required outcomes.
    - Conflict routing and provider IDs align across all three design documents.
    - Imported requirements are pinned by containment assertions against Area 3's exported table, causing the test suite to fail if a sibling edit breaks cross-doc alignment.
* New steps introduce the following localization requirements:
  * **Action Keys:** `register-sso.action.submit` and `sso-conflict.action.sign_in`.
  * **Step Titles:** Derived dynamically from step names.
  * **Copy Scope:** Conflict-step copy falls under Area 3's exported locale requirements; `register-sso.*` keys extend the exported localization table.

## Preview and Apply

The epic requires connection configurations to be visible in the plan preview while explicitly separating application from verification: applying changes is never presented as proof that sign-in works.

### The `IdpSyncer` Component

Defined as `{ kind: "idp", directory: ".zitadel/idps", revisioned: false, mutable: true }` and registered in `makeSyncers` (`apps/cli/src/lib/sync/syncers.ts:46-61`), using `FlowSyncer` as its precedent (`syncers.ts:156-159`). `BrandingSyncer`'s `revisioned: true` shape was considered and rejected: in the sync contract that flag means a hash change publishes a brand-new outer id via `create()` and triggers a re-pin scan (`lib/sync/types.ts:78-92`, `lib/sync/loop.ts:175-188`), while area 9 keeps the lineage id stable and revises through `PUT /idps/{id}` ([`9-crud-api.md#sync-contract`](9-crud-api.md#sync-contract)). The server mints the revision id under the stable outer id, which is the contract's `mutable` shape: `update()` on hash change.

* **Directory Handling:** Introduces an `IDPS_DIR` constant. Missing directories plan cleanly without error (`readJsonDir` returns empty on `ENOENT`, `lib/sync/loop.ts:506-511`).
* **Preview Behavior:** Registration alone enables create previews via the generic plan renderer (`lib/sync/plan-renderer.ts:668-687`). Update previews cannot show a field diff until a read endpoint exists (the renderer's explicit fallback, `plan-renderer.ts:763`); with area 9's get-by-slug they upgrade to a real old-vs-new diff.
* **Secret Safety:** Previews display only the variable name (`client_secret_env`), keeping output secret-free by design.
* **Re-pin Machinery:** Not engaged. The re-pin scan is the revisioned path (`lib/sync/loop.ts:175-188`) and this syncer is not revisioned; slug references make it structurally unnecessary anyway.

### Syncer Lifecycle Methods

* **`validate()`:** Evaluates against the meta-schema and validator rules from Areas 1 and 2, executing `assertEnvRefs` with the [`E_CREDENTIAL_MISSING`](#missing-credentials) split.
* **`create()` / `update()`:** `create()` posts `POST /idps`; `update()` publishes a new immutable revision under the stable lineage id via `PUT /idps/{id}` (area 9). Both depend on the CRUD API landing. Until it exists, journey file generation, validation, and `plan` previews function independently.
* **`delete()`:** Calls `DELETE /idps/{id}`. Area 9 settled deletion as tombstoning, so a local file delete schedules a platform delete unconditionally ([`9-crud-api.md#deletion-and-slug-reservation`](9-crud-api.md#deletion-and-slug-reservation)).

### Execution Handoff

* **Resource Uploads:** Connections follow the established setup upload pattern for schemas and flows (`setup-resources.ts:104-147`) once the CRUD API lands.
* **Verification Separation:** Final summaries and `next_commands` hand off directly to the Area 6 test journey. Status copy uses "applied" and never claims sign-in is "working".

## Non-interactive Contract

In non-interactive mode (triggered by non-TTY `stdin`/`stdout` or explicit `--json` flags), CLI flags supply setup answers (`setup/index.ts:219-225`, `lib/oclif/base.ts:118, 139`). Method selection flags belong to Area 2's surface area.

### Client ID Flags

* **Flag Syntax:** Provider-specific flags (e.g., `--google-client-id`, `--github-client-id`) skip interactive prompts via the `*FromFlag` pattern (`prompts/types.ts:33-73`).
* **Value Types:** Flags accept either literal strings or environment variable references (e.g., `'${GOOGLE_CLIENT_ID}'`). Passing a variable reference defers presence validation to `plan`.

### Missing Client ID Validation

If a selected provider is specified without a Client ID, setup halts prior to resource generation. The returned error envelope outputs the setup guidance normally shown in interactive mode:

```json
{
  "status": "error",
  "code": "E_VALIDATION",
  "message": "google sign-in needs an OAuth client id",
  "hint": "Create the OAuth application at https://console.cloud.google.com/apis/credentials with callback URI http://localhost:3000/__nextgen/idp/callback, then pass --google-client-id.",
  "next_commands": ["zitadel setup --auth-methods passkey,google --google-client-id <id>"]
}
```

* **No Secret Flag:** Secrets cannot be passed via CLI flags. Deferred capture is the default non-interactive behavior, allowing scaffolding to proceed normally.
* **Missing Secret Handling:** If the secret is absent from `process.env` and local environment files (`.env.local`, `.env`), the output envelope includes a warning naming the missing variable alongside remediation steps in `data.next_actions`.
* **Structured Payload (`data.idps`):** Mirrors the interactive announce step:

```json
{
  "slug": "google",
  "template": "google",
  "callback_uris": {
    "development": "http://localhost:3000/__nextgen/idp/callback"
  },
  "excluded_environments": [
    {
      "environment": "preview",
      "reason": "issuer_pattern"
    }
  ],
  "console_url": "https://console.cloud.google.com/apis/credentials",
  "client_secret_env": "GOOGLE_CLIENT_SECRET",
  "secret_present": false
}
```

**Note:** Exclusions are included structurally within the JSON payload so automated agents can reliably differentiate declaration-level exclusions from unconfigured environments without needing to parse formatted terminal text.

## Work Items

| Feature / Component | Required Work & Existing Basis |
| :--- | :--- |
| **Prompt Class & IDP Slice** | Insertion points exist (`prompts/index.ts:31-38`, `prompts/types.ts`, `setup/index.ts:219-225`). |
| **Generator Recomposition** | Area 2 open work; target shapes defined by this specification. |
| **Provider Catalog (`google`, `github`)** | New data added to `packages/config`. |
| **Connection Writer & Meta Copy** | Requires a `metaSchemaFiles()` entry and a `materializeSetupResources` block. |
| **Env Stubs & Values** | Leverages existing `merge-env` and `append-gitignore` infrastructure. |
| **`IdpSyncer`** | New component; plan rendering comes built-in. |
| **`E_CREDENTIAL_MISSING` / `E_CANCELLED` Error Handling** | Adds two codes to the closed union (`errors.ts:9-20`) and updates `EXIT_CODES`. `E_CREDENTIAL_MISSING` splits `assertEnvRefs`; `E_CANCELLED` gives the prompt funnel a cancellation signal distinct from `E_VALIDATION`, required by the Area 5 menu loop. |
| **Environment File Resolution** | Updates presence checks to inspect `.env.local` and `.env` (matching `port.ts:33`). |
| **Secret Key Collision Messaging** | Replaces generic "already matches target" message (`setup/index.ts:313-315`) with a specific no-clobber notice. |
| **Gitignore Gate** | New: validates `.env.local` via `git check-ignore` and confirms it is untracked. The nearest existing check (`doctor/checks/gitignore.ts:17-18`) only verifies `.gitignore` entries. |
| **`create_user_with_sso`** | Adds meta-schema enum value and implements the Area 3 engine handler. |
| **Doctor `env-example` Check** | Reconciles resource env refs with the scaffold (resolving drift between `doctor/checks/env-example.ts:7` and `base.ts:239-245`). |

## Exported Requirements

| Requirement | Detail | Owed By / Target Area |
| :--- | :--- | :--- |
| **Re-enterable Sub-Journey** | Callable behind the "Sign-in methods" interface with the reuse branch as default mode. | Post-claim menu (Area 5) |
| **Test Journey Handoff** | Provides execution target for exit copy; applying changes is never presented as working sign-in. | Test journey (Area 6) |
| **Default Locale Entries** | Includes translation keys for `register-sso.*` and `sso-conflict.*` (extends Area 3). | Login UI / Locale Work |
| **Validation Rule** | Enforces that steps with `on_success: create_user_with_sso` route `user_already_exists`. | Validator Work (Area 2) |
| **Multi-Schema Reuse** | Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the Area 5 post-claim menu. | Post-claim menu (Area 5) |

## Open Points

* **Flag Spelling & Multi-Select Wiring:** Settles `--auth-methods` and per-provider flag names with Area 2 generator recomposition, fixing the contract (Client IDs supplied by flag, secrets strictly excluded from argv).
* **Prefilled Console Deep-Links:** Evaluating prefilled query params (name, homepage, callback URL) for provider consoles (supported by GitHub, unsupported by Google).
* **`issuer_pattern` Shape Reconciliation:** Resolves structural divergence where CLI writes exact origin arrays (`base.ts:317-323`) while the platform contract types wildcard strings (`../platform/configuration-surface.md:144, 326`).
* **`scaffoldedFrom` Provenance:** Pending Area 1's specification for recording provenance data on generated connection resources.
* **Multi-Schema Connection Reuse:** Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the Area 5 post-claim menu.
* **Secret Rotation UX:** Defining explicit rotation workflows beyond existing no-clobber behavior in `.env.local` (deferred to Area 1 secret-store spec).

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: connection shape, catalog rationale, lifecycle, secrets)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2: schema shape, validator rules)
- [`3-social-login-flow.md`](3-social-login-flow.md) (area 3: ceremony, outcomes, conflict route)
- [`../cli/identity-surface.md`](../cli/identity-surface.md) (earlier draft: `E_CREDENTIAL_MISSING`, `.env.example` stubbing, preset catalog)
- `apps/cli/src/commands/setup/` (the journey frame), `apps/cli/src/lib/sync/` (syncers, plan renderer)
- `packages/config/defaults/default-login.json` (the base the flow scaffold extends)
