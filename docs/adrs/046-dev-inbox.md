# ADR 046: The Dev Inbox — Captured Outbound Messages

> **Status:** Proposed
> **Date:** 2026-08-02
> **Context:** `@zitadel/testing` roadmap (email/OTP capture); the [platform overview](../design/platform/overview.md)'s Dev Inbox narrative; no email delivery subsystem exists in the server yet
> **Relates to:** [ADR 035](035-configuration-environments.md), [ADR 036](036-api-credential-planes.md), [ADR 038](038-user-credential-migration-and-recovery.md), [ADR 010](010-session-auth-attempt-check-model.md)

## Decision

When the server gains outbound messaging (email first), composition and
delivery are separate steps, and every environment runs one **delivery
mode**: `capture` or a real provider. In `capture` mode the server stores the
composed message — structured variables *and* rendered forms — in the
project/environment-scoped **Dev Inbox** instead of delivering it.

The Dev Inbox is a product capability, not an internal test hook: one
operator-authenticated, cursor-paginated API with three consumers that see
the same messages — a human inbox UI, CLI JSON commands, and
`@zitadel/testing`. Environments carrying the `provider_required` policy
never capture: deploying email-dependent flows there without a configured
provider fails outright.

The platform overview already narrates this capability (the scratch
dashboard's dev inbox; the "Dev Inbox / Bring Your Own / Managed" delivery
picker). This ADR fixes the server-side contracts behind that narrative so
the delivery subsystem is designed with the inbox as a first-class citizen
rather than a bolt-on. It does not schedule the delivery subsystem itself.

## Context

Flows that deliver a secret out of band — email verification at
registration, email-OTP login, password recovery (ADR 038) — cannot be
tested end-to-end today and will not be testable when they arrive unless
tests can observe the code or link the server sent. The test kit's roadmap
names `email.waitForCode` as the missing surface; it is blocked on a
server-side story, not on kit design.

Three facts shape the options:

- **Greenfield:** the server currently has no SMTP client, no notification
  module, and no flow step that sends email. Nothing needs retrofitting —
  this is the cheapest moment to fix the contract.
- **The kit's seed principle**
  ([`packages/testing/AGENTS.md`](../../packages/testing/AGENTS.md)): every kit
  operation must stay meaningful against a remote dev instance
  (`connectZitadel`), not only a locally-booted one. A capture story that
  only works when the test controls the instance's network (an SMTP sink
  process) fails that principle.
- **The kit's parallelism model** (`packages/testing/README.md`): one shared
  instance per suite, fully parallel tests. Any consumer contract with
  test-level destructive operations or "latest message wins" semantics
  breaks under it.

### Prior art

No single product has a great end-to-end answer; each contributes one piece:

| Product | Mechanism | Take |
|---|---|---|
| Supabase | Local stack bundles a [Mailpit](https://mailpit.axllent.org/docs/api-v1/) sink (browser-first inbox); the [Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook) can replace delivery with a structured, signed webhook; [`admin.generateLink`](https://supabase.com/docs/reference/javascript/auth-admin-generatelink) mints artifacts with no delivery | Three layers, because no single one suffices; the sink is the weakest (rendered-only content, local-only, a second product to understand) |
| Firebase Auth emulator | [Emulator REST endpoints](https://firebase.google.com/docs/emulator-suite/connect_auth) return pending OOB codes/links structured (`email`, `oobCode`, `oobLink`, `requestType`) | Closest precedent for an agent-readable capture API; local-emulator-only and unauthenticated |
| Resend | [`GET /emails/{id}`](https://resend.com/docs/api-reference/emails/retrieve-email) returns the full sent message (html/text/subject/`last_event`); the dashboard is its UI; the [documented simulator recipients](https://resend.com/docs/dashboard/emails/send-test-emails) (`delivered@`/`bounced@`/`complained@resend.dev`) drive event webhooks safely | Capture as a *production* surface: read-back API and human UI over the same data |
| Clerk | [`+clerk_test` addresses](https://clerk.com/docs/guides/development/testing/test-emails-and-phones) accept the fixed code `424242`; nothing is composed or sent | Zero-config and trivially automatable — but proves nothing about recipient selection, templates, generated codes, or expiry |
| Stytch | Sandbox values (fixed test tokens) for direct API calls | Explicitly not end-to-end: unsupported through frontend SDKs |
| Better Auth | The app supplies the send callback and receives structured `url`/`token` | In-process capture is easy, but provider, templates, and fixtures are wholly DIY |

The synthesis this ADR aims for: Supabase's human inbox, Firebase's
structured API, and Clerk's zero-config feel — without Clerk's fixed-code
shortcut, and integrated with the project/environment model instead of
being a separate mail product.

## How

**One message, two forms.** Composition produces a structured record; the
transport call is a separate step. The captured record is a **versioned,
normative contract** (`schema_version`), not an indicative shape:

```json
{
  "schema_version": 1,
  "id": "devmsg_01…",
  "project_id": "proj_…",
  "environment_id": "env_…",
  "channel": "email",
  "purpose": "email_verification",
  "to": "ada@example.test",
  "template": "verify-email",
  "artifacts": { "code": "742913", "link": "https://…/verify?…" },
  "variables": { "displayName": "Ada", "code": "742913" },
  "rendered": { "subject": "Verify your email", "text": "…", "html": "…" },
  "created_at": "…",
  "expires_at": "…",
  "retained_until": "…"
}
```

Humans inspect `rendered`; agents and tests read `artifacts.code` /
`artifacts.link` — **typed, purpose-discriminated fields the composition
layer populates from the flow engine's own state** (it generated the
secret), never parsed back out of templates. Which artifacts a purpose
requires is part of the versioned contract (`email_verification` carries a
`code` and/or `link`; a magic-link purpose requires `link`). `variables`
records the template's render inputs and is *not* an API: custom
composition may rename or omit template variables freely without breaking
`waitForCode()`. `channel` and `purpose` keep SMS and webhook-style
messages behind the same contract later.

The two timestamps answer different questions. `expires_at` is **artifact
validity** — the underlying challenge's expiry, which composition
guarantees is shared by every artifact on one record (code and link
materialize the same challenge; a future purpose whose artifacts diverge
in lifetime extends the versioned schema with per-artifact expiry rather
than overloading this field). `retained_until` is **store retention** —
when the record leaves the inbox. An agent checks `expires_at` to know
whether a code is still usable; the UI shows both and renders the
expired-but-retained state distinctly.

**Delivery modes: explicit in the server, zero-config at the front doors.**
The binary captures only when configured to — a released binary never
buffers by accident. The front doors do the configuring: `zitadel start`
enables capture for local development, `startLocalZitadel()` always enables
it, preview environments default to it (the overview's pre-claim rule is
"no outbound delivery"), and `connectZitadel()` *discovers* the capability —
surfaced through `zitadel status --json` and on `InstanceHandle` — rather
than guessing. Capture replaces delivery, with no capture-and-deliver tee
mode: a captured message is provably one that was not sent.

**Production-class environments require a provider — enforced by one
policy bit.** ADR 035 deliberately defers defining which environments are
production-class ("follow-up once env-classes are defined"), so this ADR
does not classify environments either. It defines the signal the server
enforces instead: a `provider_required` policy on the environment record.
Provisioning sets it (the claim flow marks production environments;
operators can set it anywhere), and while it is set, deploying a release
that enables email-dependent flows without a configured provider
**fails** — a hard failure, not a warning. Deployment is not the only
gate, because delivery mode and provider configuration are mutable
environment state: **every provider or policy mutation validates the
invariant** (removing the provider, or enabling `provider_required`
without one, is rejected while email-dependent flows are deployed),
startup re-validates against drift, and at send time a
`provider_required` environment without a working provider **fails the
send loudly — it never falls back to capture**. When env-classes arrive,
they map classes to this policy's default. This is one deliberate divergence
from the overview's current narrative (which lists "Dev Inbox (default)"
for claimed production): customer-facing password-reset mail must not
silently land in a developer inbox. The overview gets amended to match if
this ADR is accepted.

**A scoped, cursor-paginated store.** The API contract: records are scoped
to project/environment (ADR 035), listed with cursor pagination, bounded by
retention (count cap plus TTL), and purged with their project/environment.
The contract is cursor-based from day one so the first implementation (an
in-memory store in the single-process local instance) and the eventual
durable store for shared/cloud dev environments (multi-replica) are
interchangeable behind it. **Any durable backend encrypts message content
at rest** — captured codes and links are exactly the class of retrievable
secret ADR 029 mandates AES-GCM encryption for; only the ephemeral
in-memory store is exempt.

**Read API on the operator plane** (ADR 036). Codes and links are bearer
secrets: responses carry `Cache-Control: no-store`, values never enter
request or access logs, and purge is a scoped operator/admin operation —
never part of ordinary test flow. List responses are **metadata-only**
(id, scope, channel, purpose, recipient, template, timestamps, artifact
*keys*): masking
the artifact fields alone would be theater, because `rendered.text`,
`rendered.html`, and usually `variables` embed the same code and link.
The full message — artifacts, variables, and rendered forms together —
is a separately authorized single-message read (the operator credential
today, a finer read-secret scope such as `dev_messages.read` once ADR
036's scopes land).

**Browser surfaces never hold the operator credential — and an inbox
session must be earned.** ADR 036's litmus forbids the project secret in
anything browser-delivered, and both inbox UIs are browsers, so they
follow the BFF pattern: the surface's backend holds the operator
credential and mints the browser a scoped, HTTP-only inbox session. A
signed cookie only proves the server issued it, so minting is gated on an
authenticated exchange: an authenticated human on a claimed surface
(dashboard login), or a **project-secret-mediated one-time handoff**
minted only by the explicit, human-facing `zitadel dev-inbox open`. The
transfer is specified, not just promised: the single-use short-TTL token
travels in the opened URL's **fragment** (fragments never reach the
server, so access logs cannot record them); the handoff page's script
POSTs it to the exchange endpoint, receives the HTTP-only session cookie,
and `history.replaceState`s the fragment away; inbox responses carry
`Referrer-Policy: no-referrer`; and the exchange endpoint redacts token
material from every log path as defense-in-depth. `zitadel start` never
emits a bearer-bearing URL: its JSON stdout is the agent contract and
lands in transcripts and CI logs. It reports capability state as data —
`available` (the server supports capture) vs `configured` (this
environment has it enabled) — and points at `dev-inbox open` only through
a human-facing `next_actions` hint, never through `next_commands`: the
CLI contract tells agents to prefer and *execute* `next_commands`, and
`open` both spawns a browser and requires a configured environment secret
that does not exist yet on the fresh golden path (`start` runs before
`setup`). The durable operator credential never appears in a URL or
reaches the browser. The scratch dashboard's current
anonymous first-visit cookie (platform overview) is **not** sufficient
authorization for inbox content — pre-claim, its inbox view rides the
same secret-mediated handoff. That is a second overview amendment,
alongside the delivery-mode default.

**Cursor semantics for consumers, not `clear()`.** With one shared instance
and parallel workers, a test-level `clear()` destroys other workers'
messages, and "latest message for this address" returns a stale code the
moment a test clicks *resend*. The consumer contract is take a cursor, act,
wait past the cursor:

```ts
const cursor = await zitadel.email.cursor();
await page.getByRole("button", { name: "Send code" }).click();
const message = await zitadel.email.waitForMessage({
  after: cursor,
  to: identity.email,
  purpose: "email_verification",
  artifact: "code",
});
await fillFlowField(page, "code", message.artifacts.code);
```

Filters select on recipient, purpose, and **artifact key** — a purpose
may legitimately produce a link-only message, so `artifact: "code"` waits
specifically for a code-bearing record instead of matching whatever
arrives first. Artifact *keys* (never values) are part of list metadata,
so the predicate runs server-side. `waitForCode()` is sugar for
`waitForMessage({ …, artifact: "code" }).artifacts.code`. No wall-clock
timestamps, no cross-worker destruction, no global cleanup in tests.

Waits are **bounded and cancellable**: `waitForMessage` takes `timeoutMs`
(with a kit default) and an `AbortSignal`, and on expiry throws a typed
timeout error carrying the resolved scope and filters (project,
environment, `after`, `to`, `purpose`, `artifact`) — a missing outbound
message diagnoses itself instead of surfacing as an anonymous outer
Playwright timeout. All email operations bind to an **explicit environment**:
`InstanceHandle` carries `environmentId` (a locally-booted instance has
exactly one development environment; `connectZitadel` accepts it as an
option for multi-environment projects), and cursors, waits, and reads
resolve within it — a multi-environment project can never match a message
from the wrong inbox.

The cursor is a **high-water mark, not an ADR 027 page token**: ADR 027's
tokens encode the position of an already-seen row and cannot express "end
of stream" on an empty inbox. `cursor()` returns a server-minted token
that is defined on an empty inbox (the store's current sequence
position), ordered by a server-assigned monotonic per-environment
sequence (the store serializes writes — on a multi-replica durable
backend the ordering guarantee is the store's, never a wall clock), bound
to its project/environment scope, and valid across retention and purge —
it marks a position, not a row, so trimming history before the mark
changes nothing. Tokens also embed a **store epoch** — a generation
minted when the store is created: retention and purge preserve the epoch,
but a restart or loss of the in-memory store changes it, so a cursor from
a previous process fails fast instead of sitting numerically ahead of
every new message and hanging a wait. A malformed, foreign-scope, or
epoch-mismatched token yields a distinct stale-cursor error, never a
silent empty wait. Ordinary inbox *listing* pages with ADR 027 tokens as
usual; the high-water token is the one additional type this ADR defines.

**The CLI is the agent front door.** Same API, JSON envelope per the CLI's
agent contract (`apps/cli/SKILLS.md`): `zitadel dev-inbox cursor` and
`zitadel dev-inbox wait --after … --to … --purpose … --timeout 30s`, both
`--non-interactive --json`, with the message under `data.message`. The
environment resolves deterministically — explicit `--env` wins, else the
local config's selected environment, else a hard error when ambiguous —
and every envelope echoes the resolved environment. A timeout is its own
error envelope (a distinct `code`, the resolved filters echoed for
diagnosis) with a non-zero exit; capability-disabled errors carry
`next_commands` pointing at the enabling configuration.

**A real inbox for humans.** Locally the server serves an inbox UI —
recipient/purpose/expiry at a glance, copy-code and open-link actions,
rendered preview beside a structured-variables tab, explicit "Captured —
not delivered" labeling, scoped purge — announced by `zitadel start` as
capability metadata and opened via `zitadel dev-inbox open` (see the
session-handoff rule above; `start` never prints a tokenized URL). The rendered preview treats message HTML as
untrusted (templates become tenant-authored): it renders only inside a
sandboxed iframe — no scripts, no top navigation, restrictive CSP — per
the flow-engine template-security guidance, which establishes that inline
handlers execute on naive injection and that every rendering consumer
owns its own isolation. In the cloud, the scratch dashboard's dev inbox
(platform overview) is the same API's pre-claim consumer.

**Build order: contracts before surfaces.**

1. This ADR settles the capability shape.
2. Structured composition + the transport interface.
3. The scoped capture store + operator API with cursor semantics.
4. Kit surface (`InstanceHandle.email`, `cursor()`, `waitForMessage()`).
5. CLI commands.
6. Inbox UI.
7. Real SMTP/HTTP providers behind the same transport boundary.

Agents and tests get value before the UI exists, and the UI cannot invent a
second contract later.

## Alternatives considered

- **External SMTP sink** (Mailpit-style process the kit spawns, instance
  configured to deliver to it): rejected as the primary mechanism — it
  requires an SMTP transport to exist first, adds a process to every test
  run, cannot serve `connectZitadel` targets, and forces consumers to parse
  rendered messages for codes. Supabase's own layering is the evidence:
  they bundle a sink *and* still needed the structured webhook hook and the
  admin mint API. A sink remains the right tool for asserting SMTP
  transport behavior itself, once that transport exists.
- **Log/file capture** (structured log line per outbound message, kit tails
  it): no authenticated contract, racy on rotation, unusable remotely.
- **Fixed test codes on the real server** (Clerk's `+clerk_test`/`424242`):
  rejected — it proves nothing about recipient selection, composition, code
  generation, or expiry, and it introduces a fixed-credential class into a
  real server. The fixed-code experience belongs in `@zitadel/api-mock`,
  whose job is simulated flows.
- **Admin-mint API** (Supabase `generateLink`): the server stores token
  *hashes*, so a "read the pending code" endpoint is impossible without
  weakening storage; minting a fresh artifact bypasses the send path — the
  thing under test — and would need inject-into-pending-flow semantics that
  the flow-instance model (sealed flow state, ADR 010) does not have.
  Possibly later as arrange-phase seed vocabulary; never the assert
  mechanism.
- **Kit-embedded SMTP listener** (the kit hosts a tiny SMTP server, no
  separate process): the sink with fewer moving parts and the same flaws —
  needs the SMTP transport first, needs inbound connectivity from server to
  test runner, and delivers rendered-only content.

## Consequences

- The delivery subsystem, whenever it is designed, inherits composition/
  transport separation and structured message records that outlive the
  transport call.
- Out-of-band flows (verification, email-OTP as an ADR 010 check, ADR 038
  recovery) become testable in the kit and the CLI on the day they land;
  both ship thin clients over the one API.
- Dev and preview environments knowingly trade delivery for capture;
  `provider_required` environments get a hard deploy-time failure instead
  of silent capture — which requires one amendment to the platform
  overview's delivery-mode default.
- The scratch dashboard's inbox, the local inbox UI, the CLI, and the kit
  stay one contract; none can drift into a private side channel.

## Open questions

- Composition locus: a `send` effect in the flow engine, or a notification
  service consuming events (and how that aligns with the wide-events
  direction)?
- Durable-store trigger: at what point (shared cloud dev instances,
  multi-replica) the in-memory store must be replaced.
- Support-access overlap: a support agent reading a tenant's dev inbox
  reads user secrets — same policy surface as the support-access model
  discussion.
- Consumed-state: should verifying a code mark the message consumed in the
  inbox (needs flow cooperation), or is expiry display enough?
- Does the read API belong on the existing operator port or a separate
  debug listener that deployments can firewall wholesale?
