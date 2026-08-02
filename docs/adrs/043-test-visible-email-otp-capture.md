# ADR 043: Test-Visible Email and OTP Capture

> **Status:** Proposed
> **Date:** 2026-08-02
> **Context:** `@zitadel/testing` roadmap item 2 (email/OTP capture); no email delivery subsystem exists in the server yet
> **Relates to:** [ADR 038](038-user-credential-migration-and-recovery.md), [ADR 010](010-session-auth-attempt-check-model.md)

## Decision

When the server gains outbound email delivery, it is built behind a
**transport abstraction**, and one built-in transport is **capture**: instead
of delivering, the server stores the composed message — structured, before
template flattening — in a bounded per-instance buffer and exposes it through
an **operator-authenticated read API**. `@zitadel/testing` then ships
`email.waitForCode(address)` / `email.waitForMessage(address)` as thin polls
against that API.

This ADR fixes the contract so the delivery subsystem can be designed with
capture as a first-class citizen rather than a bolt-on. It does not schedule
the delivery subsystem itself.

## Context

Flows that deliver a secret out of band — email verification at registration,
email-OTP login, password recovery (ADR 038) — cannot be tested end-to-end
today and will not be testable when they arrive unless tests can observe the
code or link the server sent. The test kit's roadmap names
`email.waitForCode` as the missing surface; it is blocked on a server-side
story, not on kit design.

Two facts shape the options:

- **Greenfield:** the server currently has no SMTP client, no notification
  module, and no flow step that sends email. Nothing needs retrofitting.
- **The kit's seed principle** (see `packages/testing/AGENTS.md`): every kit
  operation must stay meaningful against a remote dev instance
  (`connectZitadel`), not only a locally-booted one. A capture story that
  only works when the test controls the instance's network (an SMTP sink
  process) fails that principle.

## How

- **Transport abstraction.** Message composition (template id, recipient,
  variables — including the code or link — plus the rendered subject/body)
  is one step; handing the composed message to a transport is another.
  Production transports (SMTP, HTTP providers) come later; `capture` is a
  transport like any other, so tests exercise the identical composition
  path.
- **Capture is explicit, never default.** Enabled only by explicit
  configuration (env/config flag set by `startLocalZitadel` on boot, or by
  the operator of a dev instance). A released binary without the flag never
  buffers, and capture replaces delivery — no tee mode, so a captured
  message is provably one that was not sent.
- **Read API on the operator plane.** Captured messages are credentials
  (codes and reset links are bearer secrets), so the read endpoint
  authenticates like the other operator surfaces (bootstrap bearer), is
  scoped per instance, and reads from a bounded ring buffer (old messages
  drop; tests poll promptly).
- **Structured payload.** The API returns
  `{ template, to, subject, variables, body, receivedAt }` with the code and
  link as named variables — consumers never regex a rendered HTML body to
  find a code.
- **Kit surface.** `handle.email.waitForCode(address, { timeout })`,
  `waitForMessage`, and `clear()`; the Playwright fixtures re-export the
  same vocabulary. Kit-side this is a poll loop; all semantics live behind
  the server API.

## Alternatives considered

- **External SMTP sink** (MailHog-style process the kit spawns, instance
  configured to deliver to it): rejected as the primary mechanism — it
  requires an SMTP transport to exist first, adds a process to every test
  run, cannot serve `connectZitadel` targets, and forces consumers to parse
  rendered messages for codes. It remains naturally possible once an SMTP
  transport exists and is the right tool for asserting template rendering
  itself; the kit just does not ship it.
- **Log/file capture** (structured log line per outbound message, kit tails
  it): no authenticated contract, racy on rotation, unusable remotely.

## Consequences

- The delivery subsystem, whenever it is designed, inherits two
  requirements: composition/transport separation, and structured message
  records that outlive the transport call.
- Flow steps that send codes (email-OTP as an ADR 010 check, verification,
  recovery) become testable in the kit on the day they land, with no
  kit-side release needed beyond the poll helpers.
- Dev instances opting into capture knowingly disable real delivery — a
  safe default for the cloud dev-instance story, where accidental outbound
  mail is a liability.

## Open questions

- Where does composition live relative to the flow engine (a `send` effect
  on steps vs a separate notification service consuming events)?
- Buffer bounds and retention (per instance? per recipient? TTL?).
- Is capture ever acceptable on shared/cloud dev instances, and how does it
  interact with the support-access model?
- Does the read API belong on the existing operator port or a separate
  debug listener that deployments can firewall wholesale?
