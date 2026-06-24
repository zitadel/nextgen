# Analytics Tracking — Mixpanel

This package (`@zitadel/cli`) uses **Mixpanel** for anonymous product analytics.
Mixpanel is the single source of truth for usage events. Do not introduce any
other analytics tool, SDK, or tracking library without explicit instruction.

---

## Before You Add or Modify Any Tracking

⛔ **Read this file before writing any Mixpanel tracking code.**

This is a **CLI**, not a web app, so the usual identity model does not apply:
there is no logged-in user, no `identify()`/`reset()`, and no PII. Events are
attributed to an anonymous, randomly-generated install id. Treat that as a hard
invariant — never attach a user, email, project id, URL, or file path to an
event.

### Mandatory checklist

- [ ] The Node server-side SDK (`mixpanel`) is the correct SDK — do not add the browser SDK.
- [ ] No CDP is involved; events go straight to Mixpanel.
- [ ] Consent is opt-out and resolved centrally in `src/lib/telemetry/consent.ts` — never fire an event that bypasses it.
- [ ] The new event only carries allow-listed dimensions (enums, booleans, counts, versions).

---

## Tech Stack

| Detail | Value |
|---|---|
| **Platform** | Node.js CLI (oclif), ESM, Node ≥ 24 |
| **Mixpanel SDK** | `mixpanel` (server-side) |
| **SDK version** | `^0.18.1` |
| **Tracking method** | server-side, fire-and-forget |
| **CDP (if any)** | none |
| **Consent required** | yes — opt-out model (`DO_NOT_TRACK`, `ZITADEL_TELEMETRY=0`, `--no-telemetry`) |
| **Project token location** | `src/lib/telemetry/config.ts` (write-only ingestion token; dev baked in, prod via `ZITADEL_TELEMETRY_TOKEN` / release pipeline) |
| **Data region** | `ZITADEL_TELEMETRY_REGION` = `us` (default) \| `eu` |

The ingestion token is **write-only** (cannot read data back), so embedding it
in the published CLI is safe and intentional — this is how dev-tool telemetry
works. Dev and prod are separate Mixpanel projects; production is selected only
when `ZITADEL_TELEMETRY_ENV=production` (or `NODE_ENV=production`), so running
from source always lands in the dev project.

---

## Initialization

Telemetry is constructed **once per command invocation** by `BaseCommand`
(`src/lib/oclif/base.ts`) via `Telemetry.create({ env, flag, debug })` in
`toMeta()`. The generic client lives in `src/lib/telemetry`; all CLI-specific
property building (event names, `server_kind`, base/profile dimensions) lives in
`src/lib/oclif/command-telemetry.ts`. The
Mixpanel client is built lazily — only when consent is granted *and* a token is
configured. Do not construct a `Mixpanel` client anywhere else.

**File:** `src/lib/telemetry/index.ts`

**Do not:**
- Initialize Mixpanel outside `BaseCommand`.
- Write to **stdout** from telemetry — the JSON envelope is the machine
  contract; the one-time first-run notice goes to stderr and only in
  interactive mode.
- Let telemetry throw or block — every path fails open; the network is bounded
  by `Telemetry.shutdown()`'s timeout in `BaseCommand.finally()`.

---

## Identity

There is **no user identity**. Each install gets a stable, anonymous
`distinct_id` (a random UUID) persisted under the platform config dir
(`src/lib/telemetry/identity.ts`). It is tied to no account and contains no
fingerprint. On first run, `isFirstRun` drives the one-time consent notice.

---

## Tracking Plan

Three **lifecycle events** cover every command (one instrumentation point in
`BaseCommand`, so new commands are covered automatically):

| Event | Trigger | Key Properties | File |
|---|---|---|---|
| `cli_command_started` | a command begins (`toMeta`) | base dimensions | `src/lib/oclif/base.ts` |
| `cli_command_completed` | a command succeeds or skips (`emit`) | `status`, `duration_ms`, command extras | `src/lib/oclif/base.ts` |
| `cli_command_failed` | a command throws (`catch`) | `error_code`, `exit_code`, `step_reached` | `src/lib/oclif/base.ts` |

**Value Moment:** `cli_command_completed` for `command=setup` — Zitadel auth is
wired into the user's app.

### Base dimensions (every event)

`command`, `cli_version`, `os`, `arch`, `node_version`, `session_id`,
`non_interactive`, `is_tty`, `is_ci`, `ci_provider`, `host_agent`,
`invocation_channel`, `dry_run`, `force`, `server_kind` (bucketed
`cloud`/`local`/`self_hosted` — **never the URL**). Built in
`src/lib/oclif/command-telemetry.ts` (using the generic env/geo helpers in
`src/lib/telemetry/`).

### Command-specific dimensions

Commands enrich `this.telemetryProps` (merged onto every lifecycle event):

- **setup** — `framework`, `renderer`, `package_manager`, `scaffolded_skeleton`, `skip_install`, `dev_port_explicit`, `files_written_count`, `step_reached` (`framework_resolved` → `project_created` → `files_patched`).
- **plan / apply** — `creates`, `updates`, `deletes`, `total` (diff *counts* only).
- **doctor** — `runtime`, `checks_total`, `checks_failed`, `checks_warn`, `failed_checks` (failing check **names**, never messages).
- **start** — `runtime` (`binary` / `docker`).

### Naming conventions

- Event names: `snake_case`, past tense (`cli_command_completed`).
- Property names: `snake_case`; booleans use `is_`/`has_`/`dry_`/`non_` style flags.
- Omit empty properties — `compact()` drops `null`/`undefined`/`""`; never send them.

---

## How to Add a New Event or Property

1. Prefer enriching `this.telemetryProps` in the command over adding a new
   event — the lifecycle events already cover command outcomes.
2. Only add properties available at the moment the event fires; never fetch data
   just for telemetry.
3. Keep it allow-listed: enums, booleans, counts, versions. **No** URLs, ids,
   paths, emails, secrets, or free-text.
4. Add the property to the table above and cover it in
   `tests/unit/lib/telemetry/`.
5. Verify it lands in Mixpanel **Live View** (set `ZITADEL_TELEMETRY_REGION=eu`
   first if the project is in the EU region — events to the wrong host are
   silently dropped).

---

## What Not to Do

- **Do not** introduce another analytics tool.
- **Do not** track PII — no emails, names, IPs, URLs, project ids, file paths, or secrets.
- **Do not** write to stdout from telemetry.
- **Do not** let a telemetry failure surface to the user — fail open, always.
- **Do not** fire events that bypass `resolveConsent`.
