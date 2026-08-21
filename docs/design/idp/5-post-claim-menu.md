# Post-Claim CLI Menu Specification

> **Status:** Planning Notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 5 of 6 (see [`README.md`](README.md))

## Overview

This document specifies the initial interactive management surface of the CLI. Currently, the CLI ships one-shot commands (`zitadel setup`, `zitadel claim`, `zitadel plan`/`apply`, `zitadel status`) but no interactive management surface. Under Epic 851, executing the CLI against a claimed project will launch an interactive **Project Menu**, introducing **Sign-in methods** as the primary live configuration journey.

> **Vocabulary Note:** Following [#542](https://github.com/zitadel/nextgen/issues/542), the `plan` and `apply` commands will be replaced by `deploy`, `promote`, `status`, and `pull`. In this specification, treat "plan" as "preview" and "apply" as "deployment".

---

## Requirements & Acceptance Criteria

### Imported Requirements (from `4-cli-provider-setup.md`)
- [x] **Re-enterable Sub-Journey:** "Callable behind the "Sign-in methods" interface with the reuse branch as default mode." (see *Adding and Removing Methods*)
- [x] **Multi-Schema Reuse Activation:** "Multi-schema reuse logic is specified but unreachable in Epic 851's single-schema flow; activates with the Area 5 post-claim menu." (see *Schema Selection*)
- [x] **"Skip for now" Destination:** "The setup sub-journey's skip path hands the dropped provider to a concrete menu target; the final summary names it." Answered in [Guidance Updates](#guidance-updates).

### Acceptance Criteria Mapping

| Acceptance Criterion | Target Section |
| :--- | :--- |
| Running the CLI for a claimed project opens the Project menu. | [Entry Mechanics](#entry-mechanics) |
| Menu contains **Configure your Project**, **Preview and apply changes**, and **Open in Console**. | [The Project Menu](#the-project-menu) |
| **Configure your Project** opens a submenu ordered as **User profiles**, **Sign-in methods**, and **Login journeys**. | [Configure Your Project](#configure-your-project) |
| **Sign-in methods** opens the same configuration journey used during onboarding. | [Sign-in Methods](#sign-in-methods) |
| Developer can view auth methods defined by the latest schema version. | [Current Methods & State](#current-methods--state) |

---

## Core Principle: The Menu Is Navigation

The interactive menu acts strictly as a navigation layer over underlying CLI capabilities. Every live menu item routes to an addressable capability: a command endpoint, or the engines behind one. Reserved placeholders are the deliberate exception (see *Placeholder Strategy* below).

### Design Rationale
1. **`next_commands` Contract:** Envelopes and journey guidance must output runnable command strings. Workflows exclusive to terminal menus cannot be referenced in programmatic output.
2. **Automated Agents:** Non-interactive environments skip prompt loops (`lib/oclif/base.ts:139`). Subcommands provide the essential operational surface for these environments.
3. **Automated Testing:** Command-backed workflows enable direct validation via output envelope testing, allowing menu test suites to focus strictly on interactive selection logic.

### Command Routing Matrix

| Menu Entry | Command Endpoint | Implementation Status |
| :--- | :--- | :--- |
| **Main Menu** | `zitadel menu` *(routed from bare `npx zitadel` by the bin shim)* | New |
| **Configure your Project** | `zitadel configure` *(topic root)* | New topic |
| **└─ User Profiles** | *None* | Reserved placeholder |
| **└─ Sign-in Methods** | `zitadel configure sign-in-methods` | New (hosts Area 2 + 4) |
| **└─ Login Journeys** | *None* | Reserved placeholder |
| **Preview and Apply Changes** | `plan` and `apply` internal engines | Reuses existing engines |
| **Open in Console** | `zitadel console` | New command |

> **Placeholder Strategy:** Reserved entries exist only in the interactive UI to prevent advertising unbacked capabilities in CLI help documentation.

---

## Entry Mechanics

### Bare Invocation Shim
By default, `@oclif/core` outputs help text when `argv` is empty (hardcoded in `helpAddition`, `@oclif/core/lib/main.js:16-18`; no default-command setting exists). To launch the menu seamlessly:
- **Routing:** In `bin/run.js`, if `process.argv` has no command arguments and both `stdin`/`stdout` are TTYs, the shim injects the `menu` command ID.
- **Safety:** All non-TTY executions and standard flags (`--help`, `--version`) remain untouched to ensure CI pipelines do not hang.

### State Routing (`zitadel menu`)
The `menu` command evaluates local project state and falls back to help if the menu does not apply:

| State | Behavior |
| :--- | :--- |
| **No `zitadel.json`** | Delegates to help output. Setup remains the documented entry for new projects. |
| **Claim state: `detached`** | Prints one `consola.info` line quoting `claimAction` copy, then shows help. |
| **Claim state: `not-applicable`**| Delegates to help output (e.g., local/self-hosted servers). |
| **Claim state: `attached`** | Opens the interactive Project Menu. |

*Note: Claim state is detected locally via `claimState()` without network overhead.*

### Explicit Invocation & Non-Interactive Envelope
`zitadel menu` is a hidden command (`static hidden = true`). Under `--json` or non-interactive execution, it emits a skipped envelope to guide automated agents:

```json
{
  "cli_version": "0.1.0-alpha.19",
  "command": "menu",
  "source": "https://api.zitadel.cloud",
  "status": "skipped",
  "reason": "non-interactive",
  "data": {
    "title": "The Project menu needs an interactive terminal."
  },
  "next_commands": [
    "zitadel configure sign-in-methods",
    "zitadel plan",
    "zitadel apply",
    "zitadel console"
  ]
}
```

---

## The Project Menu

```text
$ npx zitadel

Connected Project: Acme

What would you like to do?

❯ Configure your Project
  Preview and apply changes
  Open in Console
```

### Display & Lifecycle Semantics
- **Dynamic Header:** "Acme" is fetched live via `GET /projects/{id}`. It is not cached locally since it can be renamed on the platform. On network failure, it degrades gracefully to the project ID.
- **Loop Architecture:** After a sub-journey completes, the menu re-renders with fresh state.
- **Error Handling:** Sub-journey errors render standard output (message, hint, `next_commands`) but do *not* exit the process, allowing developers to fix files externally and retry. (Exception: unreadable core files like `.zitadel/secret` will exit).
- **Cancellation:** Pressing `Esc` or `Ctrl+C` cleanly exits the menu (Code 0). Inside a sub-journey, cancellation returns the user to the parent menu. Today every clack cancel funnels through `bail()` (`setup/prompts/cancel.ts`), which throws `E_VALIDATION`, indistinguishable from a real validation failure; the re-hosted sub-journey must raise a distinct cancellation signal so the loop can return silently instead of rendering an error (see *Exported Requirements*).
- **Telemetry:** Records a single `menu_choices` property at flush: the ordered selections of the invocation (values `configure`, `plan_apply`, `console`, `exit`). Telemetry is a per-invocation property bag flushed once (`base.ts:73-99`); re-recording a scalar per selection would keep only the last choice. `Telemetry.track()` (`lib/telemetry/index.ts:103`) could emit per-selection events, but the `BaseCommand` convention fires lifecycle events only, one per invocation, and the menu keeps that cardinality.

---

## Configure Your Project

```text
What would you like to configure?

❯ User profiles
  Sign-in methods
  Login journeys
```

- Order is fixed by acceptance criteria.
- **User profiles** and **Login journeys** are functional placeholders. Selecting them prints manual configuration instructions (e.g., edit `.zitadel/schemas/` or `.zitadel/flows/`) and returns to the menu. They will be swapped for interactive journeys when their respective areas land.

---

## Sign-In Methods

Addressable via `zitadel configure sign-in-methods`. This journey combines Area 2 (`x-auth-methods`) and Area 4 (Provider Setup). Non-interactive runs accept Area 4 flags (e.g., `--auth-methods`).

### Schema Selection
Scans working tree schemas (`.zitadel/schemas/*.json`):
- **Single file:** Displays a banner naming the file.
- **Multiple files:** Displays a picker categorized by `objectType` and filename. A provider selected for a second schema activates Area 4 multi-schema reuse: the reuse branch extends the connection's `claim_mapping` with superset semantics instead of duplicating the connection ([Create or Reuse](4-cli-provider-setup.md#create-or-reuse)).

### Current Methods & State

```text
Sign-in methods for human-user (.zitadel/schemas/default-human-user.json)

◆ How should these users sign in?
│ ◼ Passkey
│ ◻ Password
│ ◼ Google (configured)
│ ◻ GitHub (requires setup)
```

- **Seeding:** Pre-selections read directly from the schema's current `x-auth-methods`.
- **Hints:** Providers resolve as `(configured)` if a corresponding connection file exists in `.zitadel/idps/`; otherwise `(requires setup)`. The hint states file presence only: applied-ness is the drift warning's job, and only area 6 may say a provider works.
- **Custom Providers:** Providers outside the standard catalog render as read-only notes and pass through recomposition untouched.
- **Drift Warning:** If the file hash mismatches the last-applied record in `.zitadel/state.json` (hash mechanics: `hashForState`, `lib/sync/loop.ts:577`), the UI appends `includes local changes not yet applied`.

> **Interpretation Note:** The epic's Console criterion reads "latest schema version" as the latest applied revision (the active-flow pin). This journey reads the working tree because the tree is what it edits; the drift warning bridges the two readings.

### In-Place Recomposition Rules
The CLI must edit user configurations in place without destroying customizations:
1. **Owned Regions:** The generator exclusively owns `x-auth-methods` entries and Area 4 flow scaffold deltas (e.g., `sso_providers` arrays, `register-sso` steps, password toggles, and the conflict step's password field and passkey action, which follow the method set).
2. **Atomicity:** Edits are computed in-memory, validated against meta-schemas/cross-resource rules, and written atomically.
3. **Safety Bailout:** An owned region is edited, in either direction, only when its current value equals what the scaffold expects (e.g. `register.user_already_exists` reverts to `password` only if it currently targets `sso-conflict`). On any other value the CLI aborts with `E_CONFLICT`, writes nothing, and points the user to manual editing.

### Adding and Removing Methods
- **Adding:** Unchecked providers route to the [Area 4 setup sub-journey](4-cli-provider-setup.md#the-sub-journey) (environment callback URIs, credential capture). Defaults to **reuse** mode.
- **Removing Validation:** The CLI enforces that at least one method remains checked.
- **Schema/Flow Edits on Removal:** The slug is removed from `sso.providers` and from every step's `sso_providers` array. An emptied `sso.providers` list becomes `{"enabled": false}` (list dropped); an emptied step array drops that step's SSO-only transition keys, prunes now-unreachable steps (`register-sso`, `sso-conflict`), and reverts `register.user_already_exists` to its pre-scaffold target `password` (mechanically invertible).
- **Resource Preservation:** De-selecting a provider *never* deletes the connection file in `.zitadel/idps/` or credentials in `.env.local`. Plan engines handle inert connection warnings (Area 1).

### Exit
The journey concludes by invoking the **Preview and Apply Changes** engine. Declining the confirmation keeps the recomposed files in the working tree (the CLI never reverts developer-owned files); exit copy states changes are saved to `.zitadel/` but not applied. Post-apply exit copy consistently states changes were "applied" (verifying successful auth is delegated to Area 6 testing).

---

## Preview and Apply Changes

Reuses existing `plan` and `apply` internals (`buildSyncPlan`, `renderPlan`, `summarizePlan`, `runSyncLoop`) within the menu process.

- **In Sync:** Reports "everything is in sync" and returns to menu.
- **Pending Changes:** Displays plan summary followed by an explicit confirmation prompt (required for menu executions).
- **Errors:** Validation or `E_CREDENTIAL_MISSING` errors show hints (e.g., check `.env.local`) and return to menu for retry.
- **Secrets:** Connection files flow through `IdpSyncer` identically to Area 4; previews omit secret values.

---

## Open in Console

Addressable directly via `zitadel console`.

### URL Resolution & Persistence
The console URL is minted server-side (`consoleBaseURL + "/projects/" + projectID`, `internal/service/claim.go:292-294`); the CLI cannot derive it locally, and it is deliberately absent from `GET /projects/{id}`.
1. **Storage:** The CLI writes `dashboard_url` to `.zitadel/secret` upon successful `zitadel claim`.
2. **Standard Execution:** Reads `dashboard_url` from the secret, prints it, and opens the system browser (unless `--no-open` is passed).
3. **Legacy Backfill:** If `dashboard_url` is absent, the CLI calls `initClaim`, intercepts the expected `409 Conflict`, extracts the URL from the response details, backfills the secret, and opens the browser. The server side is in place: the 409 contract requires `details.team_id` and `details.dashboard_url` (`api/openapi/endpoints/projects/by_id/claim/init/already-claimed-response.yaml`), the service attaches them (`internal/service/claim.go:285-290`).
4. **Mismatch Handling:** If `initClaim` unexpectedly succeeds on the platform (minting a challenge) while the local record says attached, it indicates a desync; the CLI halts without continuing the challenge (it expires on its own) and advises running `zitadel claim`.

---

## Guidance Updates

Updates to existing CLI hints to drive menu discovery:
- **`zitadel claim` success:** Appends `Run "npx zitadel" to open the Project menu.`
- **`zitadel status` (attached):** Appends the same pointer to staged guidance.
- **Area 4 Skip:** Replaces generic skip text with precise instructions: `Run "npx zitadel", choose "Configure your Project", then "Sign-in methods"`, or directly: `zitadel configure sign-in-methods`.

---

## Work Items

| Module | Notes |
| :--- | :--- |
| **`bin/run.js`** | Bare-invocation routing via empty `argv` + TTY check to inject `menu`. |
| **`menu` command** | Hidden command setup, state routing table, loop, cancel handlers, envelope. |
| **`configure` topic** | Topic creation and `sign-in-methods` sub-command with Area 4 flags. |
| **Schema Picker** | Multi-select UI seeded from `x-auth-methods`, plus `SCHEMAS_DIR` scanner. |
| **Recomposition** | In-place file edits, inverse flow scaffolding, and `E_CONFLICT` safety checks. |
| **Sync Extraction** | Extract `plan.ts`/`apply.ts` logic for in-process UI reuse; add confirm gate. |
| **Console Routing** | `dashboard_url` storage, legacy 409 backfill, and `console` command. |
| **Guidance / Telemetry** | Update status text hints and implement the `menu_choices` telemetry property. |
| **Tests** | Menu routing and loop unit tests; journey coverage rides the Area 2/4 work; e2e strategy belongs to Area 6 (`apps/cli-journey-e2e`). |

---

## Exported Requirements

| Requirement | Detail | Target Area |
| :--- | :--- | :--- |
| **In-place Recomposition** | Generator owns specific regions, computes in memory, validates atomically, and bails with `E_CONFLICT` when an owned region's current value differs from the expected state. | Area 2 |
| **Invertible Scaffold** | Area 4 flow deltas (e.g., retargeting `user_already_exists`) must remain mechanically invertible for clean de-selection; inversion applies only from the exact expected scaffold state. | Area 2 / 4 |
| **Test Journey Surface** | Exit copy (or a menu row) hands off to the test journey; CLI avoids asserting that auth "works". | Area 6 |
| **Cancellation Signal** | Sub-journey prompts must distinguish user cancellation from validation failure (today both throw `E_VALIDATION` via `bail()`), so the menu loop can return silently on cancel. Tracked as `E_CANCELLED` in Area 4's errors.ts work item. | Area 4 (prompt funnel) |
| **Claim-State Read API** | Server needs an authenticated read returning `dashboard_url` without minting a challenge (to replace the 409 backfill). | Server Contract |
| **E2E Strategy** | e2e coverage belongs to `apps/cli-journey-e2e`; Area 6 settles the strategy. | Area 6 |

---

## Open Points

- **Command Spellings:** Final confirmation of `menu`, `configure` topic, `console`, and lifecycle of placeholders.
- **#542 Sequencing:** This area ships against the current `plan`/`apply` surface, but ADR 035 removes both commands outright (`deploy` replaces `apply`; "plan has no replacement", [ADR 035, CLI](../../adrs/035-configuration-environments.md#cli)). When the release model lands, the **Preview and apply changes** row, the sync extraction, and the `zitadel plan`/`zitadel apply` strings in the skipped envelope swap to the `deploy`/`status` surface; the extraction work item is rework if #542 lands first.
- **Pre-claim / Local Menus:** Potential future variants for uninitialized directories or local-dev (currently fall back to help).
- **Environment Selection:** Adding environment prompting into Preview/Apply when multi-environment support lands (#534).
- **Project-name Caching:** Investigating if live `getProject` reads make the menu initialization feel slow.
- **Inert Connections:** Deletion semantics are open (area 1, Open Points); the local UX question is separate: whether removing the last provider should prompt to delete the connection file.

## Related

- [`4-cli-provider-setup.md`](4-cli-provider-setup.md) (area 4: the sub-journey this menu re-hosts, the scaffold delta, the non-interactive contract)
- [`2-auth-method-selection.md`](2-auth-method-selection.md) (area 2: `x-auth-methods` shape, validator rules, the generator open point)
- [`1-resource-model.md`](1-resource-model.md) (area 1: connection lifecycle, inert-connection warning, deletion semantics)
- [`3-social-login-flow.md`](3-social-login-flow.md) (area 3: the outcomes the flow edits route)
- `apps/cli/src/commands/claim.ts`, `src/lib/claim-state.ts`, `src/lib/project.ts` (attachment record and detection)
- `apps/cli/src/commands/plan.ts`, `apply.ts`, `src/lib/sync/` (the preview-and-apply engines)
- `apps/cli/src/lib/journey-guidance.ts`, `src/lib/public-cli.ts` (guidance and command normalization)
- `internal/service/claim.go` (dashboard URL construction)
