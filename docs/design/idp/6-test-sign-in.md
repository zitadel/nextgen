# Test-Sign-In Journey

> **Status:** Planning notes  
> **Epic:** [zitadel/nextgen#851](https://github.com/zitadel/nextgen/issues/851)  
> **Area:** 6 of 7 (see [`README.md`](README.md))

## Overview

This document defines how a developer verifies that an applied social-login configuration signs a real user in, and how a failed attempt is classified as provider misconfiguration or a Zitadel journey failure. It is the verification counterpart of areas 4 and 5: those apply configuration, this journey proves it. It also settles the e2e strategy for the epic (owed to `apps/cli-journey-e2e` by area 5).

**Vocabulary note:** `plan` and `apply` will be replaced by `deploy/promote/status/pull` ([#542](https://github.com/zitadel/nextgen/issues/542)). Read "apply" as "deployment".

---

## Requirements and Acceptance Criteria

### Imported Requirements

- [x] **Failure-details channel (area 3):** "Details are written to server logs and the test journey (area 6); tenant-side misconfigurations are hidden from the end user." Answered in [Diagnostic events](#diagnostic-events) and [End-user surface](#end-user-surface).
- [x] **Test journey handoff (area 4):** "Provides execution target for exit copy; applying changes is never presented as working sign-in." Answered in [Entry points](#entry-points): the target is `zitadel test sign-in`.
- [x] **Test journey surface (area 5):** "Exit copy (or a menu row) hands off to the test journey; CLI avoids asserting that auth "works"." Decided in [Entry points](#entry-points): exit copy this iteration, no menu row.
- [x] **E2E strategy (area 5 work item):** e2e coverage belongs to `apps/cli-journey-e2e`. Answered in [E2E strategy](#e2e-strategy).

### Acceptance Criteria Mapping

| Acceptance criterion (epic, Testing) | Target section |
| :--- | :--- |
| The developer can test the complete Google or GitHub sign-in journey. | [The shape of the test](#the-shape-of-the-test) |
| Applying the configuration is not presented as confirmation that sign-in has been successfully tested. | [Entry points](#entry-points) |
| A failed test identifies whether the provider configuration or the Zitadel journey failed and provides a relevant recovery action. | [Verdicts and classification](#verdicts-and-classification) |
| Internal technical details are not exposed directly to the end user. | [End-user surface](#end-user-surface) |

---

## The Shape of the Test

The test is a real sign-in. The CLI opens the browser at the scaffolded app's login page, the developer completes the ceremony with their own provider account, and the CLI observes the attempt server-side and reports a verdict.

### Observation Over Driving

The CLI observes rather than drives, for three reasons:

1. **The binding nonce forces same-client continuity.** The `state` record's nonce cookie requires the client that submits the sso action to be the client that returns on the callback (area 3, [The `state` record](3-social-login-flow.md#the-state-record)). Consent happens in the developer's browser, so the callback returns there; a CLI-side submission would strand the callback in a browser that never held the nonce. The ceremony must therefore start in that browser, and weakening the check for tests would remove a login-CSRF defence.
2. **Provider authentication cannot be automated.** No vendor exposes an API for completing an interactive OAuth consent, and per-vendor automation code is prohibited by the series' "vendor knowledge is data" rule.
3. **The epic asks for the complete journey.** "The test covers the complete journey from leaving Zitadel to returning successfully." Starting from the app's login page covers everything a real user hits: flow resolution, button rendering, the dev proxy, the origin check, the ceremony, identity resolution, and flow completion.

### Boundaries

- **Start:** the login page renders and the developer clicks the provider button. Whether the button renders at all is covered by preflight and by the `no_attempt_observed` reason.
- **End:** the engine completes the flow, meaning terminal handoff (`capabilities.md`, terminal-step handoff). What the app does with the session afterwards belongs to the SDK scaffold, not to this journey.
- **Backend location does not change the ceremony.** The callback enters through the app's dev proxy (`/__nextgen/:path*`, area 4 proxy scope note), so a local runtime and the hosted platform run the same ceremony, and observation reads the management API in both cases. Attribution of what was observed does differ; see [Observation](#observation).
- **Target environment:** development only in this iteration. It is the only environment with a derivable exact issuer today (area 4, [Callback URIs](4-cli-provider-setup.md#callback-uris)); multi-environment targeting depends on [#534](https://github.com/zitadel/nextgen/issues/534).

### Classification Principle

A failure verdict names the leg that broke, in the epic's two buckets: provider authentication or the Zitadel journey. The provider leg spans everything between leaving for the authorize URL and the engine holding a usable external identity: the authorize redirect, callback error parameters, token exchange, id_token validation, userinfo, and the supplementary fetch. The Zitadel leg is everything around it: state validation, claims evaluation, identity resolution, and flow continuation. The reason code under the verdict names the exact fix location, which is not always on the same side: `invalid_scope` breaks at the provider but may be fixed in the connection's `scopes` array. The leg answers "where did it stop", the reason answers "what to change". The buckets apply only where a failure was observed: outcomes carrying no failure signal (a denial, an expired window, a state the engine cannot attribute) get an inconclusive tier whose recovery copy names the likeliest fix as a lead, never as a finding. Designed outcomes and user actions never masquerade as configuration failures.

The earlier draft's `zitadel idp test` (a dry-run discovery and token-exchange probe, [`../cli/identity-surface.md`](../cli/identity-surface.md)) splits: the discovery half survives as preflight check 8, the token-exchange half is deferred (see [Open points](#open-points)). A dry run can validate reachability and configuration shape; the live ceremony proves redirect URIs and the journey itself.

---

## Entry Points

The journey is addressable as `zitadel test sign-in` (a new `test` topic, following area 5's command routing convention). Per the menu-is-navigation principle, every surface routes to this command:

| Surface | Handoff |
| :--- | :--- |
| Setup summary (area 4, step 6) | When connections were applied and secrets are present, `next_commands` gains `zitadel test sign-in --provider <slug>`. |
| Sign-in methods exit (area 5) | Post-apply exit copy appends the same command. |
| Preview and apply changes (area 5) | When the applied plan contained idp resources, completion copy appends it. |

**No menu row this iteration.** The epic's Project menu shows exactly three rows and area 5's acceptance criteria fix that list. Exit copy reaches the developer at the moment the test is relevant, right after apply. A standing row is worth revisiting when re-testing becomes recurring (secret rotation, multi-environment); recorded in [Open points](#open-points).

The wording rules stay in force on every surface: apply copy says "applied", never "working" (area 4, verification separation). Only a completed test run reports sign-in as working.

---

## Command Surface

```text
zitadel test sign-in [--provider google] [--timeout 300] [--url <login page>] [--check] [--no-open] [--json]
```

### Flags

| Flag | Behavior |
| :--- | :--- |
| `--provider` | Connection slug to test. Interactive default: a picker over providers offered by applied flows, skipped when only one is offered. Required under `--json` when more than one is offered. |
| `--timeout` | Observation window in seconds, default 300. The window bounds how long the CLI waits, not the attempt: retries and the double redirect mint fresh attempts inside one window. Attempt TTLs are engine-owned; an engine-side expiry surfaces as `attempt_expired`. |
| `--url` | Login page override. Default: development origin plus `login_path` from `zitadel.json` when present, else `/login` (the scaffold default). The scaffolded path itself lives in app source the developer may edit (`loginPath`, `lib/orca/patchers/rule/next/index.ts:27`) and is not readable back; see the work item on persisting it. |
| `--check` | Run preflight only: no browser, no observation. |
| `--no-open` | Print the login URL instead of opening the browser (same guard as claim, `commands/claim.ts:162`). |

**Non-interactive contract.** `--json` runs the same preflight and observation and never prompts. The browser leg is left to the operator or a test driver; the login URL is deterministic, so nothing needs to be parsed from streaming output. The final envelope carries the verdict.

### Exit Semantics

| Exit | Verdicts | Meaning |
| :--- | :--- | :--- |
| `status: "ok"` (exit 0) | `pass`, `conflict_route` | The configuration works. |
| `E_TEST_FAILED` | `failed_provider`, `failed_journey` | A configuration failure was established. |
| `E_TEST_INCONCLUSIVE` | `provider_denied`, `inconclusive` | The test did not complete; nothing established a configuration failure. |

Error envelopes carry `status: "error"` and a non-zero exit; inconclusive is distinguished by code, not by a third status. Automation retries `E_TEST_INCONCLUSIVE` and alerts on `E_TEST_FAILED`. Both codes are new entries in the closed error union (`errors.ts:9-20`) and `EXIT_CODES`, beside area 4's `E_CREDENTIAL_MISSING`. Preflight failures keep their own codes (`E_LOCAL_SERVER_NOT_RUNNING`, `E_CREDENTIAL_MISSING`, `E_VALIDATION`): they mean the test could not start, not that it failed.

### Failure Envelope Example

```jsonc
// test sign-in failure envelope
{
  "status": "error",
  "cli_version": "0.1.0-alpha.19",
  "command": "test:sign-in",
  "source": "https://api.zitadel.cloud",
  "code": "E_TEST_FAILED",
  "message": "google sign-in failed during provider authentication",
  "hint": "The token endpoint rejected the client (invalid_client). Check GOOGLE_CLIENT_SECRET in .env.local, then rerun the test.",
  "next_commands": ["zitadel test sign-in --provider google"],
  "details": {
    "verdict": "failed_provider",
    "reason_code": "token_exchange_rejected",
    "provider": "google",
    "connection_revision_id": "idprev_01KWJ0Q9AEB7N4S1D8F2K6M3PX",
    "last_milestone": "callback_received",
    "milestones": ["attempt_started", "callback_received"],
    "console_url": "https://console.cloud.google.com/apis/credentials",
    "callback_uris": { "development": "http://localhost:3000/__nextgen/idp/callback" }
  }
}
```

Cancellation (Esc / Ctrl+C) during observation emits the standard skipped envelope; no verdict is recorded.

Telemetry: one `test_sign_in` event carrying verdict and reason code, nothing account-shaped.

---

## Preflight

Ordered and fail-fast; each failure names its fix. `--check` stops here.

| # | Check | On failure |
| :--- | :--- | :--- |
| 1 | Backend reachable with the stored bearer (local runtime: `checkLocalServerHealth`, `lib/local-server/runtime.ts`; auth per the runtime registries, `lib/sync/loop.ts:27-29`) | `E_LOCAL_SERVER_NOT_RUNNING` with `zitadel start`, or `E_NETWORK` / `E_AUTH` |
| 2 | App dev server responds at the development origin (`readDevelopmentIssuer`, `lib/project.ts:180`) | `E_VALIDATION`: start the app (`npm run dev`); the login page must be served |
| 3 | A connection file exists for `--provider` and passes validation | `E_VALIDATION` with `zitadel configure sign-in-methods` |
| 4 | Secret value present locally (`assertEnvRefs` split, area 4) | `E_CREDENTIAL_MISSING` naming the variable and `.env.local` |
| 5 | Connection, schema, and flow applied and drift-free (state hash vs file hash, `lib/sync/loop.ts:566`) | Never applied: `E_VALIDATION` with `zitadel apply`. Drifted: warning; the test proceeds against the applied revisions and says so. |
| 6 | Provider actually offered: the schema's `sso.providers` lists it and an applied flow carries it in `sso_providers` with all three outcomes routed (area 2 validation rules) | `E_VALIDATION` naming the missing side |
| 7 | The environment declares an exact issuer, not `issuer_pattern` (area 3 exclusion) | `E_VALIDATION` |
| 8 | OIDC only: discovery document fetch resolves authorize and token endpoints, or explicit overrides exist | Warning, not an error: names the issuer and notes the engine will fail the same way if it is a typo |
| 9 | Diagnostics read responds: opening the observation window returns a server-issued cursor (the one observation polls from) | `E_VALIDATION` naming the missing route: the server predates the diagnostics read; the test cannot observe, so the browser is never opened |

Two limits, stated in the output rather than papered over:

- **Check 4 proves local presence only.** Whether the engine holds the secret value at token exchange is exactly what the live test proves; the delivery mechanism is area 1's open secret lifecycle.
- **Check 6 reads the working tree plus `state.json`.** It cannot reproduce the engine's audience-based flow resolution (`capabilities.md`, resolution). With the single scaffolded definition the check is exact; multi-definition projects get "at least one applied flow offers it" and the observation phase settles the rest.

---

## Observation

1. Preflight passes; check 9 already opened the observation window and holds its server-issued cursor. The CLI resolves the login URL, prints what will happen and that the developer's own provider account will be used, and opens the browser.
2. The developer signs in with the provider. For a first-time account entering on the sign-in page, the copy warns about the two ceremonies (the double redirect, area 4 UX trade-offs).
3. The CLI polls the diagnostics read (below) about every two seconds from that cursor, filtered by provider, and renders milestones as they arrive.
4. The loop ends on a terminal event (`journey_completed`, `identity_resolved` with `user_already_exists`, or a failure reason) or when the window expires.
5. The report renders: verdict, milestone timeline with timings, the resolution outcome, the connection revision the attempt bound (area 1 revision binding, read from the events), and a recovery block on failure.

### Details

- **Attempts group into chains by `flow_id`.** The double redirect's two ceremonies share one flow; a page reload or a parallel tab starts another. The verdict comes from the chain with the latest terminal event, and the report lists every chain that was active in the window. A chain settles at its first terminal event; later events on a settled chain (a replayed callback) are reported, never reclassified. Unattributable `state_invalid` events belong to no chain and never outrank one: they set the verdict (`inconclusive`, `state_invalid`) only when no chain reached a terminal event, and otherwise appear as a flagged note.
- **Nothing yet binds an attempt to this CLI run.** On a local runtime the developer is alone, so window correlation is exact. On a hosted development instance shared by a team, a colleague's concurrent sign-in is indistinguishable from a retry; the report flags windows with more than one active chain instead of silently picking one. The attempt marker that would resolve attribution, and the observer-privacy rule that comes with it, are an open point designed together with the diagnostics read.
- **Atomic single-use state consumption is an area 3 requirement**, recorded inside its open storage-shape point. This journey depends on it and adds no requirement of its own.
- **Real users are created.** A passing first run creates a real account in the development instance; rerunning then exercises the returning-user branch. The report names which branch ran, so two runs cover sign-up and sign-in. `zitadel reset` deletes the local runtime and its data when a clean slate is needed.
- **The conflict route is not a failure.** `user_already_exists` routed to the authored conflict step is designed behavior (area 3), so it concludes the test with its own verdict, `conflict_route`, the moment resolution fires. The continuation through the conflict step's sign-in action is a password or passkey journey outside this test's scope.

---

## Diagnostic Events

The engine emits one structured event per attempt milestone. This is the contract verdicts are computed from.

| Rule | Why |
| :--- | :--- |
| Events carry `ts` and either a `milestone` or a `reason_code`; the attempt-scoped fields (`attempt_id`, `provider_slug`, `connection_revision_id`, `flow_id`) whenever a state record resolves | The CLI correlates by window and provider, then groups attempts into chains by `flow_id` |
| A `state_invalid` event for an unknown state is unattributable: its attempt-scoped fields are null and the read returns it regardless of any provider filter | The one failure with no state record must not be silently dropped by the CLI's filter |
| `provider_error_returned` events carry `provider_error`: the provider's error code verbatim (`access_denied`, `invalid_scope`, GitHub's nonstandard names) | An error code is machine data, not prose; the verdict mapping branches on it and the report echoes it |
| `milestone` and `reason_code` are closed vocabularies; `detail` is optional prose mirroring the server log line. The emitter owns keeping `detail` inside the value-free rule below: a log line carrying a URL or a claim value is reduced to its code, not mirrored | The CLI branches on codes, never on message text |
| Value-free: claim names, mapped property names, and verification booleans may appear; claim values, subjects, tokens, secrets, and URLs with query strings never do | Events cross the management API into terminal output; area 1's secret invariant ("never upstream of anything diffed, hashed, committed, or printed") applies |
| Ordered per attempt | Verdicts read "the furthest milestone reached" |

Milestones map to area 3's callback processing: `attempt_started` (submission accepted, authorize URL built), `callback_received` (state validated), `token_exchanged` (code exchanged, id_token validated), `claims_extracted` (extraction, supplementary fetch, verification evaluation), `identity_resolved` (outcome fired, outcome name attached), `journey_completed` (terminal handoff). Failure codes interleave where they occur. When an enabled auto-creation gate degrades to `user_not_found` (area 3), `identity_resolved` also names the unmet condition as property names (missing, or present but unverified), never values. The outcome milestone is not callback-only: when `user_already_exists` fires at collection-step submission (area 3's second execution point), `identity_resolved` fires there too, so `conflict_route` classifies identically at both trigger points.

```jsonc
// idp-attempt diagnostic event
{
  "ts": "2026-08-18T09:30:12Z",
  "attempt_id": "idpatt_01KWJ2R7Q4T8SBN3M6V9XCZDEF",
  "provider_slug": "google",
  "connection_revision_id": "idprev_01KWJ0Q9AEB7N4S1D8F2K6M3PX",
  "flow_id": "flow_01KWJ2QH5D8FA3G7P2W4YBTMEX",
  "reason_code": "token_exchange_rejected",
  "detail": "token endpoint returned 401 invalid_client"
}
```

**Transport.** The CLI reads events through an authenticated management endpoint: project-scoped, service-key bearer (the same auth the sync engine sets at command boot, `lib/sync/loop.ts:27-29`), returning events in order. Correlation is anchored to server time: opening the window returns a server-issued cursor and the CLI pages forward from it, so a skewed workstation clock cannot misfile events against a hosted engine. An optional provider filter narrows the stream but never withholds unattributable `state_invalid` events. An events surface already exists to reconcile with: [ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md)'s wide-events audit log (one append-only `events` table, an `auth` category, a deny-by-default PII policy that matches the value-free rule above, and "reconstruct the full timeline for this login flow" as a motivating query) and [ADR 049](../../adrs/049-events-api-retention-export.md)'s unified `/events` API (cursor pagination per ADR 027, filters including `flow_id`), partially implemented as `ListEvents` (`internal/api/event.go`). Whether these milestones ride that stream as `event_type` rows or need a dedicated diagnostics read is an open point below; a dedicated endpoint must justify itself against ADR 048's one-table decision, and ADR 048's pre-claim read gate (events stored from project creation, list/get gated until claim) bounds where the journey can observe. This document contributes the requirements above either way.

### Rejected Alternatives

| Alternative | Why not |
| :--- | :--- |
| Scrape `zitadel logs` output | Couples the CLI to log formatting across two runtimes (binary file vs docker) and cannot serve remote environments under #534. Logs stay the deep-detail channel (area 3); the `zitadel logs` pointer stays in recovery copy. |
| Expose details on the public flow API | The flow response is end-user-facing. Area 3 requires tenant misconfiguration details hidden from end users; a debug field there would leak them to any browser. |
| CLI drives the flow API and reads errors first-hand | The callback would return to a browser that never held the binding nonce, and the app surface is skipped entirely; see [The shape of the test](#the-shape-of-the-test). |

---

## Verdicts and Classification

```jsonc
// test-sign-in verdict and reason-code catalog
{
  "verdicts": [
    "pass",
    "conflict_route",
    "failed_provider",
    "failed_journey",
    "provider_denied",
    "inconclusive"
  ],
  "milestones": [
    "attempt_started",
    "callback_received",
    "token_exchanged",
    "claims_extracted",
    "identity_resolved",
    "journey_completed"
  ],
  "reason_codes": [
    "provider_error_returned",
    "token_exchange_rejected",
    "endpoint_unreachable",
    "id_token_invalid",
    "userinfo_failed",
    "supplementary_fetch_failed",
    "subject_invalid",
    "state_invalid",
    "attempt_expired",
    "engine_error"
  ],
  "cli_reasons": [
    "window_expired",
    "no_attempt_observed"
  ]
}
```

`reason_codes` arrive as events. `cli_reasons` are derived by the CLI (no event exists for a window closing); they appear in envelopes and reports only, never in the event stream.

| Verdict | Derived from | Exit |
| :--- | :--- | :--- |
| **`pass`** | `journey_completed` observed | ok |
| **`conflict_route`** | `identity_resolved` with outcome `user_already_exists` | ok |
| **`failed_provider`** | Provider-leg reason codes (rows below) | `E_TEST_FAILED` |
| **`failed_journey`** | Zitadel-leg reason codes: `subject_invalid`, `engine_error` | `E_TEST_FAILED` |
| **`provider_denied`** | `provider_error_returned` with `provider_error: "access_denied"` | `E_TEST_INCONCLUSIVE` |
| **`inconclusive`** | `state_invalid`, `attempt_expired`, `window_expired`, `no_attempt_observed` | `E_TEST_INCONCLUSIVE` |

| Signal | Verdict | Meaning and recovery action |
| :--- | :--- | :--- |
| No event within the window | `inconclusive` (`no_attempt_observed`) | The button was never clicked, or never rendered. If it is missing from the page: the applied flow does not offer the provider (rerun preflight) or the rendering work is incomplete (area 3, Rendering). |
| `attempt_started`, then nothing | `inconclusive` (`window_expired`) | Stranded at the provider, or the tab was closed; no signal distinguishes the two, which is why this is not `failed_provider`. The classic strandings never redirect back: an unregistered redirect URI or a wrong client id, shown on the provider's own error page. Recovery leads with them anyway, as leads: it re-prints the exact callback URI, the client id source, and the catalog's console URL. |
| Callback with `provider_error: "access_denied"` | `provider_denied` | Cancelled or denied at the provider. Rerun and approve. A repeating denial with no consent screen shown means the provider or an org policy blocks the app (publication state, user access rules); reruns cannot fix that. |
| Callback with another provider error code (`invalid_scope`, `unauthorized_client`, `server_error`, ...) | `failed_provider` (`provider_error_returned`, `provider_error` echoed) | The authorize request was rejected. Compare the connection's `scopes` with the provider app's configuration; check the app's publication or suspension state. |
| Token endpoint rejects the exchange | `failed_provider` (`token_exchange_rejected`) | Wrong client secret, or a `token_endpoint_auth_method` pin that does not match the provider (area 1 pins). Recovery names `client_secret_env` and `.env.local` (no-clobber rule: edit it there). |
| Token or userinfo endpoint unreachable | `failed_provider` (`endpoint_unreachable`) | Endpoint or issuer typo in the connection (OAuth2 endpoints are explicit), or an egress failure from the engine host. Recovery names both; preflight check 8 disambiguates the OIDC half. |
| id_token signature, `iss`, `aud`, or `nonce` fails | `failed_provider` (`id_token_invalid`) | Wrong issuer or client id in the connection, or a missing `jwks_uri` where discovery is absent (area 3, callback step 3). |
| Userinfo or supplementary fetch fails | `failed_provider` (`userinfo_failed` / `supplementary_fetch_failed`) | Endpoint configuration, or runtime token scopes. For `github_primary_email`: the schema enforces `user:email` in the configured scopes, but the provider app can still restrict what the token carries. |
| Subject absent or malformed | `failed_journey` (`subject_invalid`) | `subject_claim` names a claim the provider does not send (required for OAuth2, area 1). Fix the connection file. |
| State unknown or already consumed | `inconclusive` (`state_invalid`, unattributable when no record resolves) | A replayed callback or a stale link. Never outranks a live chain (see Observation). Recurring in a fresh single-tab run points at the engine, read `zitadel logs`. |
| State resolves but the binding nonce does not match | `inconclusive` (`state_invalid`) | The ceremony continued in a different client than the one that started it. The record resolves, so the event is attributable and the report names the chain. Finish the test in the browser the CLI opened. |
| State expired before the callback returned | `inconclusive` (`attempt_expired`) | The external leg outlived the attempt TTL (slow consent screens); the TTL is locked, not configurable (`../api/authn-and-auth-flows.md`, TTL). Rerun; recurring expiry on a fast consent points at an engine defect, read `zitadel logs`. |
| Resolution or `create_user_with_sso` fails | `failed_journey` (`engine_error`) | Engine-side failure. Recovery points at `zitadel logs` for the deep detail (area 3's channel). |
| `identity_resolved` with `user_already_exists` | `conflict_route` | The ceremony succeeded and the account collides; the authored recovery route engaged, exactly what areas 3 and 4 scaffold for. Test fresh sign-up with a different provider account. |
| Window expires after `identity_resolved` with `user_not_found` | `inconclusive` (`window_expired`), outcome reported | The collection step is waiting for input; complete it or rerun. When auto-creation was enabled, the report names the unmet condition from `identity_resolved` (missing vs unverified property names). |

**Success report.** `pass` names the branch that ran: returning user (`callback` on a known subject), new user through collection, or auto-created (`is_auto_creation`). `conflict_route` reports that the ceremony worked and the conflict wiring engaged. Both name the connection revision the attempt bound, so a drifted working tree cannot be mistaken for what was tested (preflight check 5 prints the same drift status).

---

## End-User Surface

The test changes nothing in the browser. Failures render exactly as area 3 specifies: a generic localized error on the originating step, retry and method-switch affordances, no tenant configuration detail. The developer-facing detail exists only behind the authenticated diagnostics read and in server logs. That split answers the epic's "Internal technical details are not exposed directly to the end user": the test journey adds detail to the terminal, never to the login page.

---

## E2E Strategy

`apps/cli-journey-e2e` covers this journey in CI. Real providers cannot: accounts, consent screens, and bot detection make Google and GitHub unusable in automation, and no real-provider credential belongs in CI.

- **A mock provider process, owned by the e2e app.** A small OIDC plus OAuth2 server started by the journey runner on an allocated port (block allocator, `apps/cli-journey-e2e/scripts/ports.mjs`): discovery, JWKS, an auto-approving authorize endpoint, token, userinfo, and a GitHub-shaped variant (`/user`, `/user/emails`) to exercise `supplementary_fetch`. It is not `packages/api-mock`: api-mock mocks the Zitadel API for frontend development, while this suite runs the real server binary end to end and must mock the external provider instead.
- **Scaffold through the real journey, then repoint at the mock.** The suite selects the provider through the real setup or sign-in-methods journey (covering areas 2, 4, and 5 wiring), then repoints the connection file at the mock provider. The `google` lane swaps the `issuer`, so discovery against the mock is actually exercised; the `github` lane rewrites the three explicit endpoints (OAuth2, `client_secret_post`, supplementary fetch). The connection schema supports both shapes (area 1).
- **Two assertions per lane.** Playwright drives the app's login page through the mock ceremony and asserts the signed-in session card, the same end state the existing journey suites assert. Concurrently, `zitadel test sign-in --json --no-open --provider <slug>` observes, and the suite asserts the verdict envelope.
- **Failure injection proves the classifier.** The mock provider exposes per-run failure modes, each pinned to one expected verdict and reason code: wrong secret (`token_exchange_rejected`), `error=access_denied` (`provider_denied`), never-redirect (`inconclusive` with `window_expired` at `attempt_started`), tampered nonce (`id_token_invalid`), missing subject claim (`subject_invalid`). Asserting only the happy path would leave the classification table unproven.
- **CI gating.** A new `journey_sso` variant beside the four existing gated variants ([#744](https://github.com/zitadel/nextgen/issues/744) pattern, `scripts/ci-mode.mjs`): skipped when a PR cannot affect it, never silently passed. The app and the mock provider both stay on `localhost`.
- **No real-provider lane.** Not even env-gated. The interactive test journey is the real-provider path, run by a developer with their own account.

---

## Work Items

| Item | Notes |
| :--- | :--- |
| Engine: milestone and failure events | At area 3's six callback steps, plus `attempt_started` at submission and `journey_completed` at terminal handoff; `provider_error` echo and auto-creation detail per the event contract |
| Server: diagnostics read | Project-scoped, service-key authorized; reconciled with ADR 048/049's `/events` surface, remainder settled with area 1's CRUD API |
| CLI: `test` topic, `sign-in` command | Preflight, observation loop, verdict mapping, report rendering |
| CLI: `E_TEST_FAILED`, `E_TEST_INCONCLUSIVE` | New codes in the closed union (`errors.ts:9-20`) and `EXIT_CODES` |
| CLI: exit-copy handoffs | Setup summary, sign-in-methods exit, preview-and-apply completion (areas 4 and 5 surfaces) |
| CLI: login URL resolution | Persist `login_path` in `zitadel.json` for new scaffolds (beside the development issuer, `lib/orca/patchers/rule/base.ts:317`); `/login` fallback for existing apps; `--url` override |
| e2e: mock provider and `journey_sso` lanes | Failure-injection matrix pinned to the reason-code catalog |
| Telemetry | `test_sign_in` event: verdict and reason code only |

---

## Exported Requirements

| Requirement | Owed by |
| :--- | :--- |
| Diagnostic events at every callback milestone, value-free, closed vocabularies | Engine (extends area 3's engine work; owns the taxonomy and milestone split) |
| `journey_completed` emitted at terminal handoff for SSO-resolved attempts | Engine |
| Diagnostics read: project-scoped, ordered, cursor-anchored to server time, provider filter that never drops unattributable events | Server, reconciled with ADR 048/049's events surface (remainder settled with area 1's CRUD API) |
| `provider_error` echoed verbatim on `provider_error_returned`; `identity_resolved` carries the outcome and unmet auto-creation conditions (property names only); `identity_resolved` fires at both `user_already_exists` execution points (callback resolution and collection-step submission) | Engine (error taxonomy) |
| Exit copy on the area 4 and 5 surfaces names `zitadel test sign-in` | CLI (areas 4 and 5 implementation) |

---

## Open Points

- **Event storage and retention.** Owned by ADR 048/049 if the events stream carries these milestones (persisted in the `events` table, retention per ADR 049); only a dedicated in-memory channel would lose events on a server restart. Either way a mid-test gap must be detected and named by the CLI rather than reported as `no_attempt_observed`. Tied to area 3's open state-storage shape.
- **Endpoint shape.** Whether the diagnostics read is ADR 049's `/events` (milestones as `event_type` rows, the existing `flow_id` filter, ADR 027 cursors) or a dedicated route. The deciding constraints: the closed milestone/reason vocabularies, unattributable `state_invalid` events (attempt-scoped fields null), the server-issued window cursor, and ADR 048's pre-claim read gate. Path, pagination, and authz scope naming settle there, together with the CRUD API (area 1 open point). The CRUD API adds no dedicated diagnostics route; the read stays on the events surface.
- **Menu row.** Revisit a standing "Test sign-in" row when re-testing becomes recurring (secret rotation, #534 multi-environment). Exit copy is the only surface this iteration.
- **Login page location.** The scaffolded path lives in app source the developer may edit and is not readable back; `zitadel.json` persistence covers new scaffolds only, and SPA widget postures may host sign-in anywhere. `--url` covers every case manually; detection beyond the recorded value is undesigned.
- **Actor binding and observer privacy.** Nothing binds an observed attempt to the CLI run that opened the browser; on a shared development instance the report can only flag ambiguity. The intended fix is an attempt marker minted by the CLI and carried into flow creation, designed together with the diagnostics read. The same design owns the privacy rule: value-free events bound what one developer's terminal can see of a colleague's sign-in, and #534 remote targeting must not proceed without the marker.
- **Preflight credential probe.** A deliberate invalid-code token exchange would distinguish `invalid_client` from `invalid_grant` and catch a wrong secret without a ceremony. Deferred: run from the CLI it duplicates engine protocol behavior and proves the workstation's secret value, not the one the engine resolves at exchange time (area 1's open secret lifecycle owns that join). Revisit as an engine-side dry run once the CRUD API exists.
- **Multi-environment testing.** #534 introduces exact issuers per environment. The diagnostics read must then work against remote engines, preflight check 4 no longer applies (the value lives in the environment's store, area 1's open secret lifecycle), and the actor-binding marker above becomes a precondition.
- **Multi-flow prediction.** Preflight approximates the engine's audience-based flow resolution; exact prediction would duplicate engine logic in the CLI. Single-definition scaffolds are exact.

---

## Related

- [`1-resource-model.md`](1-resource-model.md) (area 1: revision binding, config pins, secret invariant)
- [`3-social-login-flow.md`](3-social-login-flow.md) (area 3: callback steps, failures table, engine work)
- [`4-cli-provider-setup.md`](4-cli-provider-setup.md) (area 4: callback URIs, credential capture, verification separation)
- [`5-post-claim-menu.md`](5-post-claim-menu.md) (area 5: menu-is-navigation, exit surfaces)
- [ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md) / [ADR 049](../../adrs/049-events-api-retention-export.md) (the shipped events surface the diagnostics read reconciles with; `ListEvents`, `internal/api/event.go`)
- [`../flowengine/capabilities.md`](../flowengine/capabilities.md) (terminal handoff, flow cookie TTL)
- [`../cli/identity-surface.md`](../cli/identity-surface.md) (earlier draft: the `idp test` dry-run, absorbed into preflight)
- `apps/cli/src/lib/errors.ts`, `commands/logs.ts`, `lib/local-server/runtime.ts` (error union, logs, health)
- `apps/cli-journey-e2e/AGENTS.md` (suite rules the SSO lanes inherit)
