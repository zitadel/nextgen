# ADR 056: Passkey registration is an auth-attempt check

> **Status:** Accepted — 2026-08-22

## Context

Passkey login and passkey registration entered the codebase as two unrelated
stacks. Login runs through the auth-attempt machinery: a `checks` row per
(attempt, type) carries the challenge payload, failure counter, and expiry, and
`POST /sessions/exchange` promotes verified factors onto a session.
Registration (PR #195) had its own `passkey_registrations` table, its own
service (`Begin`/`Finish`), and its own flow-engine port carrying the comment
"intentionally separate: credential enrollment is distinct from identity
verification". Issue #220 (raised in the PR #195 review) asked for the fork to
be resolved: registration should ride the auth-attempt machinery or a generic
Registration API.

The fork had accumulated real seams:

- `RegisterCreatedUser` fabricated a synthetic, pre-succeeded "user check" on
  the attempt so the exchange could smuggle the created user's id onto the
  session. Sessions born from sign-up carried no real factor.
- Password sign-up created user + credential atomically
  (`on_success: create_user`), while passkey sign-up created a provisional
  user in a separate transaction from the credential write and swallowed
  `user_already_exists` (the divergence ADR 017 flags as unresolved).
- Registration had no failure accounting, no cleanup, and no non-browser
  surface, while login challenges had all three concerns handled by the
  checks machinery.

## Decision

Registration becomes an `AuthCheckTypePasskeyRegistration` check on the auth
attempt; the parallel stack is deleted.

1. **The checks row is the ceremony's state carrier.** The registration
   challenge payload — including the provisional user handle WebAuthn needs
   before the user row exists — lives in `challenge_payload`, exactly where
   login challenges keep theirs. No temporary user row exists at any point.
   The ceremony keeps its own 5-minute window inside the 15-minute attempt,
   and failed attestations bump the check's `failure_count`.
2. **The finish leg is atomic.** Verifying the attestation lands the user row
   (for a provisional ceremony, via the same `UserAction` seam
   `create_user` uses), the credential, a real user factor, and the check
   success in one transaction on the shared statement pool.
   `user_already_exists` rolls everything back and routes like the
   identifier-dispatch outcome instead of being swallowed.
3. **A completed registration is a verified passkey-class factor.** Creating a
   credential with user verification proves possession and presence just like
   an assertion does for that credential, so the exchanged session is
   passkey-authenticated. On the wire the factor renders as method `passkey`;
   the distinct check type is internal bookkeeping.
4. **Password sign-up records real factors symmetrically.** The `create_user`
   handler records verified user + password factors on the attempt in its own
   transaction (the user just chose the password, so knowledge is proven).
   `RegisterCreatedUser` and its synthetic check are deleted.
5. **Provisional-or-not is decided server-side.** A pinned user factor pins
   the enrollment target. Without one, a caller-supplied handle is checked
   against the user store: an existing row means enrollment for that user
   (e.g. right after a discoverable passkey login, which pins no user check
   row), a missing row means the ceremony creates the user at finish.
6. **The flow port merges into `FlowAuthAttemptService`.** This supersedes the
   "intentionally separate" rationale on the deleted
   `FlowPasskeyRegistrationService`: enrollment and verification are distinct
   *semantically* (hence the distinct check type), but their mechanics —
   challenge issue, proof verify, expiry, rate limiting, audit, session
   promotion — are the same machinery, and the fork duplicated it.

Management-plane enrollment (`POST /users/{user_id}/passkeys` begin/finish
under `user.write`, follow-up PR) rides the same machinery through an internal
attempt that is never exposed to the caller, giving backends API-only passkey
sign-up parity with `POST /users` + `PUT /users/{id}/password`.

## Alternatives considered

- **A generic Registration API** (issue #220's second option): a first-class
  registration-session resource owning user + password + passkey enrollment.
  Rejected because it duplicates the challenge/proof/expiry/handoff plumbing
  for one credential type and still needs a bridge onto sessions — the part
  the attempt machinery already owns.
- **Hardening the fork**: keep the separate stack and give it failure
  counting, cleanup, and a REST surface. Rejected: it keeps the synthetic
  user check, the two-transaction seam, and two state stores for one concern.

## Consequences

- Enrollment and authentication share rate limiting, challenge expiry, audit
  events, and exchange semantics; sign-up sessions carry real factors and
  assurance levels can reflect how the user actually proved themselves.
- `passkey_registrations` (all three dialects), `PasskeyRegistrationService`,
  `FlowPasskeyRegistrationService`, `FlowPasskeyUserCreater`,
  `RegisterCreatedUser`, and the `pkreg` prefix/error code are gone.
  Pre-release, the migrations were folded away in place.
- The glossary's `auth_attempt` widens to "authentication or
  credential-enrollment ceremony". The name is now broader than
  "authentication attempt" suggests; renaming remains cheap while pre-release
  and is tracked as debt, not done here (see also ADR 047 on the `att`
  prefix).
- Abandoned ceremonies now age out with abandoned attempts — one cleanup debt
  instead of two (no GC exists yet for either).
- The wire contract of `POST /flow/{id}/submit` is unchanged except
  `pkreg.not_found`, which is replaced by the existing `att.*` codes.
