# ADR 038: User Credential Migration and Recovery

> **Status:** Proposed
> **Date:** 2026-07-15
> **Context:** credential migration and account recovery flows

## Context

This document defines the standard operating procedures for user credential migration and account
recovery. The primary objective of these policies is to keep credential upgrades transparent to
users and to ensure legitimate users are not accidentally locked out of their accounts during
routine credential lifecycle events.

## Decision

### 1. Password Rehashing and Migration

The system leverages `passwap.Swapper` combined with the `password_hasher` configuration to handle
both parameter upgrades (rehashing) and complete algorithmic switches (migration).

When a user logs in, the provided password is verified against the stored hash.
`(*passwap.Swapper).Verify` returns `(upgradedEncodedHash, error)`; when it returns an upgraded hash
for parameter upgrades or algorithm migration, the server will persist that upgraded hash to the
database. It returns an empty string otherwise.

Persisting the upgraded hash is not part of the login's critical path. The user has already
authenticated by the time it is available, so a failed write is logged, and the login succeeds; the
rehash is simply retried on the next login.

### 2. Passkey Migration

Unlike passwords, passkeys (asymmetric keys) cannot be transparently rehashed or migrated by the
server.

- **Soft Enrollment Nudge:** The system will prompt users to register a second passkey after their
  first successful passkey authentication if they have fewer than two enrolled. This prompt is a
  dismissible "soft nudge," not a strict gate.
- **Device Change:** The user registers a new passkey on the new device. They may manually revoke
  the old passkey if it is no longer necessary.
- **Deregistration Safeguards:** If a user attempts to deregister their final passkey, they must
  first register a new passkey or set up an alternative authentication method. A qualifying
  alternative is another factor the account can authenticate with on its own: a second passkey, a
  password, or an enrolled TOTP secret. This guarantees the account always retains at least one
  usable factor and the user isn't locked out.
- **Device Loss:** Users regain access via configured account recovery methods (see
  [Section 4](#4-account-recovery)). Upon successful recovery, the system immediately prompts the
  user to register a replacement passkey and then revoke the lost one. The order matters: when the
  lost passkey was the user's only one, the deregistration safeguard above forbids revoking it
  first.

#### RP ID Migration (Domain Changes)

Passkey credentials are permanently bound to the WebAuthn Relying Party ID (`rpId`) they were
created under, and that binding cannot be changed, so a new `rpId` cannot reuse existing
credentials. Related Origin Requests do not move a credential onto a new `rpId`; they let the
existing `rpId` be exercised from additional origins, so a new domain can keep using the old-`rpId`
passkeys. The migration is therefore:

- Keep the old `rpId` and serve it from the new domain via
  [**Related Origin Requests (ROR)**](https://passkeys.dev/docs/advanced/related-origins/), listing
  the new origin in the RP's `.well-known/webauthn`. ROR caps the number of related origins and has
  uneven browser support, so treat it as a transition aid, not a permanent state.
- Over that transition window, prompt users to register a fresh passkey under the new `rpId`, then
  retire reliance on the old one.

### 3. TOTP Enrollment

A user has a single TOTP secret. Rotating it is a replace-in-place operation: the new secret takes
over and the old one stops working once the new one is verified.

- **Adding or replacing a device:** The user enrolls the new device's secret, which replaces the old
  one.
- **Device Loss:** If the user can still authenticate with another factor, they enroll a replacement
  secret. If TOTP was their only factor, they recover via a method in
  [Section 4](#4-account-recovery) and then enroll a new secret.
- **Deregistration:** Removing the TOTP secret is subject to the same last-factor safeguard as
  passkeys ([Section 2](#2-passkey-migration)): if it is the account's only remaining usable factor,
  the user must set up an alternative before it can be removed.

### 4. Account Recovery

Account recovery acts as the fallback mechanism when a user cannot authenticate with any enrolled
method. A project's configured methods decide which mechanisms below apply; not every account uses
passkeys or TOTP, and some sign in with username plus an emailed code (see
[Magic Links and Email Codes](#magic-links-and-email-codes)).

#### Recovery Codes

- A set of static recovery codes is generated and cryptographically hashed during the user's initial
  MFA enrollment.
- Each code is strictly single-use.
- Because each code is single-use, the set depletes over time. When a user runs low on or exhausts
  their codes, they are prompted to regenerate a fresh set; regenerating invalidates any codes
  remaining from the old set.
- A password-only account relies on ordinary password reset, which is out of scope here.

#### Magic Links and Email Codes

Control of a verified email is proven with a single-use magic link or a one-time code sent to that
email. It serves two roles, and each project configures which it offers:

- **Primary authentication.** A project can offer email sign-in in place of or alongside passkeys
  and TOTP. Some projects prefer username plus an emailed code and skip passkeys entirely.
- **Account-recovery fallback.** When a user cannot authenticate with any enrolled method, a single-use magic link or email OTP helps them authenticate.

The link or code is single-use and enforces a strict, configurable expiration window (e.g., 15
minutes).

Note: Recovery via email is a per-project setting and can be disabled: because it bypasses every
enrolled factor and reduces account security to email possession, high-assurance projects (for
example under a NIST profile per [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#nist)) can
turn it off. That concerns the recovery role only; a project that chooses email as its primary
authentication method has accepted that assurance level by design.

Post-recovery, the user should be prompted to re-register their lost authentication factors
(Passkey, TOTP, etc.) to ensure they have at least one valid factor for future logins.

## Consequences

Adopting these consolidated migration and recovery strategies introduces the following trade-offs:

### Positive

- Multi-path account recovery (single-use codes and short-lived magic links) means losing one
  authentication factor is a recoverable event rather than a lockout.

### Negative / Risks

- Recovery is not a guarantee against lockout. A user who loses both their recovery codes and their
  email access has no path back in. We accept that outcome because the only escape hatch would be
  letting support restore access.
- Email-based recovery floors an account's security at the security of its email inbox, because it
  bypasses every enrolled factor. For an account otherwise protected by a passkey this is a
  downgrade, so projects that cannot accept it can disable recovery via email (magic links, email OTPs)
  ([Section 4](#4-account-recovery)).

## Questions

1. During an account recovery event, what is the exact policy for invalidating a user's pre-existing
   active sessions and revoking outstanding refresh tokens? Does recovery revoke every session, or
   only the ones bound to the lost factor?

2. How do we discern between a regular sign-in event vs. a recovery event (when a recovery code wasn't used), so
   re-enrollment of factors can be prompted?

3. When a project uses username plus an emailed code as its primary method
   ([Magic Links and Email Codes](#magic-links-and-email-codes)), do we enforce a second factor or
   allow email OTP as the sole factor? Is this a product decision, or a per-project policy?

## Follow-up work

1. Password rehash persistence ([Section 1](#1-password-rehashing-and-migration)).
2. Recovery code generation / consumption flow ([Recovery Codes](#recovery-codes)).
3. Email magic-link / one-time-code flow for both authentication and recovery, including the
   email-sending infrastructure it depends on
   ([Magic Links and Email Codes](#magic-links-and-email-codes)).