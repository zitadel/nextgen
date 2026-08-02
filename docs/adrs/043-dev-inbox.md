# ADR 043: The Dev Inbox — Captured Outbound Messages

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
`@zitadel/testing`. Production-class environments never capture: enabling
email-dependent flows there without a configured provider fails loudly at
deploy time.

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
- **The kit's seed principle** (see `packages/testing/AGENTS.md`, added by #709): every kit
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
| Resend | [`GET /emails/{id}`](https://resend.com/docs/api-reference/emails/retrieve-email) returns the full sent message (html/text/subject/`last_event`); the dashboard is its UI; `*@resend.dev` simulator recipients drive event webhooks safely | Capture as a *production* surface: read-back API and human UI over the same data |
| Clerk | [`+clerk_test` addresses](https://clerk.com/docs/guides/development/testing/test-emails-and-phones) accept the fixed code `424242`; nothing is composed or sent | Zero-config and trivially automatable — but proves nothing about recipient selection, templates, generated codes, or expiry |
| Stytch | Sandbox values (fixed test tokens) for direct API calls | Explicitly not end-to-end: unsupported through frontend SDKs |
| Better Auth | The app supplies the send callback and receives structured `url`/`token` | In-process capture is easy, but provider, templates, and fixtures are wholly DIY |

The synthesis this ADR aims for: Supabase's human inbox, Firebase's
structured API, and Clerk's zero-config feel — without Clerk's fixed-code
shortcut, and integrated with the project/environment model instead of
being a separate mail product.

## How

**One message, two forms.** Composition produces a structured record; the
transport call is a separate step. A captured record (indicative shape):

```json
{
  "id": "devmsg_01…",
  "project_id": "proj_…",
  "environment_id": "env_…",
  "channel": "email",
  "purpose": "email_verification",
  "to": "ada@example.test",
  "template": "verify-email",
  "variables": { "code": "742913", "link": "https://…/verify?…" },
  "rendered": { "subject": "Verify your email", "text": "…", "html": "…" },
  "created_at": "…",
  "expires_at": "…"
}
```

Humans inspect `rendered`; agents and tests read `variables.code` /
`variables.link` — nobody regexes HTML for a code. `channel` and `purpose`
keep SMS and webhook-style messages behind the same contract later.

**Delivery modes: explicit in the server, zero-config at the front doors.**
The binary captures only when configured to — a released binary never
buffers by accident. The front doors do the configuring: `zitadel start`
enables capture for local development, `startLocalZitadel()` always enables
it, preview environments default to it (the overview's pre-claim rule is
"no outbound delivery"), and `connectZitadel()` *discovers* the capability —
surfaced through `zitadel status --json` and on `InstanceHandle` — rather
than guessing. Capture replaces delivery, with no capture-and-deliver tee
mode: a captured message is provably one that was not sent.

**Production-class environments require a provider.** One deliberate
divergence from the overview's current narrative (which lists "Dev Inbox
(default)" for claimed production): customer-facing password-reset mail
must not silently land in a developer inbox. When email-dependent flows are
enabled in a production-class environment (ADR 035 slots) without a
configured provider, deployment fails or warns decisively. The overview
gets amended to match if this ADR is accepted.

**A scoped, cursor-paginated store.** The API contract: records are scoped
to project/environment (ADR 035), listed with cursor pagination, bounded by
retention (count cap plus TTL), and purged with their project/environment.
The contract is cursor-based from day one so the first implementation (an
in-memory store in the single-process local instance — the kit's 80% case)
and the eventual durable store for shared/cloud dev environments
(multi-replica; encrypted at rest) are interchangeable behind it.

**Read API on the operator plane** (ADR 036). Codes and links are bearer
secrets: responses carry `Cache-Control: no-store`, values never enter
request or access logs, list responses may mask `variables` by default with
full values behind a read-secret scope (`dev_messages.read` once
fine-grained operator scopes exist), and purge is a scoped operator/admin
operation — never part of ordinary test flow.

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
});
await fillFlowField(page, "code", message.variables.code);
```

`waitForCode()` remains as sugar over `waitForMessage(...).variables.code`.
No wall-clock timestamps, no cross-worker destruction, no global cleanup in
tests.

**The CLI is the agent front door.** Same API, JSON envelope per the CLI's
agent contract (`apps/cli/SKILLS.md`): `zitadel dev-inbox cursor` and
`zitadel dev-inbox wait --after … --to … --purpose … --timeout 30s`, both
`--non-interactive --json`, with the message under `data.message`.
Capability-disabled errors carry `next_commands` pointing at the enabling
configuration.

**A real inbox for humans.** Locally the server serves an inbox UI —
recipient/purpose/expiry at a glance, copy-code and open-link actions,
rendered preview beside a structured-variables tab, explicit "Captured —
not delivered" labeling, scoped purge — and `zitadel start` prints its URL
next to the instance URL. In the cloud, the scratch dashboard's dev inbox
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
  production-class environments get a decisive deploy-time signal instead
  of silent capture — which requires one amendment to the platform
  overview's delivery-mode default.
- The scratch dashboard's inbox, the local inbox UI, the CLI, and the kit
  stay one contract; none can drift into a private side channel.

## Open questions

- Composition locus: a `send` effect in the flow engine, or a notification
  service consuming events (and how that aligns with the wide-events
  direction)?
- Durable-store trigger: at what point (shared cloud dev instances,
  multi-replica) the in-memory store must be replaced, and whether
  encryption at rest is required from its first durable version.
- Support-access overlap: a support agent reading a tenant's dev inbox
  reads user secrets — same policy surface as the support-access model
  discussion.
- Consumed-state: should verifying a code mark the message consumed in the
  inbox (needs flow cooperation), or is expiry display enough?
- Does the read API belong on the existing operator port or a separate
  debug listener that deployments can firewall wholesale?
