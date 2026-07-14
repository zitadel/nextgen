# ADR 035: Credential Migration, Rotation, and Recovery

> **Status:** Proposed
> **Date:** 2026-07-11
> **Context:** credential migration, key rotation, and recovery flows

## Context

This document defines the standard operating procedures for credential migration and rotation,
account recovery flows, and emergency key compromise handling. The primary objective of these
policies is to prevent irreversible security exposures while ensuring legitimate users are not
accidentally locked out of their accounts during routine security lifecycle events.

## Decision

### 1. Password Rehashing and Migration

The system leverages `passwap.Swapper` combined with the `password_hasher` configuration to handle
both parameter upgrades (rehashing) and complete algorithmic switches (migration).

When a user logs in, the provided password is verified against the stored hash.
`(*passwap.Swapper).Verify` returns `(upgradedEncodedHash, error)`; when it returns an upgraded hash
for parameter upgrades or algorithm migration, the server will persist that upgraded hash to the
database. It returns an empty string otherwise.

Persisting the upgraded hash is not part of the login's critical path. The user has already
authenticated by the time it is available, so a failed write is logged and the login succeeds; the
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

A user can enroll more than one TOTP secret, the same way they can enroll more than one passkey. The
secrets are independent, and at verification a submitted code is accepted if it matches any enrolled
secret for the user. Adding an authenticator is enrollment, and retiring one is a separate, optional
removal.

- **Adding or replacing a device:** The user enrolls the new device's secret alongside any existing
  ones. The old secret keeps working until the user removes it.
- **Device Loss:** If the user can still authenticate (a second TOTP secret or another factor), they
  enroll a replacement and remove the lost one. If the lost device held their only factor, they
  recover via a method in [Section 4](#4-account-recovery) and then enroll a new secret.
- **Deregistration:** Removing a TOTP secret is subject to the same last-factor safeguard as
  passkeys ([Section 2](#2-passkey-migration)): if it is the account's only remaining usable factor,
  the user must set up an alternative before it can be removed.

### 4. Account Recovery

Account recovery acts as the fallback mechanism when a user loses an authentication factor (Passkey,
TOTP) and cannot authenticate with a remaining one.

#### Recovery Codes

- A set of static recovery codes is generated and cryptographically hashed during the user's initial
  MFA enrollment.
- Each code is strictly single-use.
- Because each code is single-use, the set depletes over time. When a user runs low on or exhausts
  their codes, they are prompted to regenerate a fresh set; regenerating invalidates any codes
  remaining from the old set.
- A user only has recovery codes if they enrolled an MFA factor. A password-only user relies on
  ordinary password reset, which is out of scope here.

#### Magic Links

- A single-use magic link is generated and sent to the user's verified email address.
- Links enforce a strict, configurable expiration window (e.g., 15 minutes) and are only valid for a
  single use.
- Magic-link recovery is a per-project setting and can be disabled. Because it bypasses every
  enrolled factor and reduces account security to email possession, high-assurance projects (for
  example under a NIST profile per [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#nist))
  can turn it off.

Post-recovery, the user should be prompted to re-register their lost authentication factors
(Passkey, TOTP, etc.) to ensure they have at least one valid factor for future logins.

### 5. Signing Key Lifecycle

#### Background and Pain Points

Zitadel's legacy key-management model expired keys automatically (private keys after 6h, public keys
after 30h, by default), causing certain issues (follow
[discussion #7464](https://github.com/zitadel/zitadel/discussions/7464) for details):

1. the `jwks_uri` returned for idle/low-traffic instances was empty after 30h of inactivity, read by
   users as ZITADEL being broken or non-compliant.
2. apps that pre-fetch/cache the JWKS broke when a token was signed with a `kid` that wasn't yet
   cached by those apps.
3. userinfo/introspection failures when an instance's configured access-token lifetime exceeded the
   public key's expiry window.

The current [webkeys](https://zitadel.com/docs/guides/integrate/login/oidc/webkeys) model in Zitadel
fixed this with an explicit `create → activate → delete` lifecycle where keys never auto-expire,
which made key rotation a deliberate process and the same key could stay active indefinitely.

#### Proposal

The proposal defined here addresses these pain points and affords tenants automatic key rotation
(defaults to 30 days per [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#rotation)). The
signing keys are [scoped per project](029-cryptography-secrets-and-key-lifecycle.md#scope); the JWKS
endpoint serves all keys currently valid for that project. A signing key pair is generated for every
project by default at creation time (`active_from = now()`, since no cached JWKS can exist yet), so
a project can sign from the moment it exists and is never in a keyless state.

Each key stores two timestamps: `active_from`, the instant it may begin signing, and `retired_at`,
the instant it stops signing because a successor took over. A key's `retired_at` is null until a
successor is created, at which point it is set to that successor's `active_from`. Everything else
about a key's lifecycle is computed from these two timestamps.

Three configured durations govern the signing key lifecycle:

- **Propagation window:** how long a newly created key waits before it signs anything. It is the
  maximum cache lifetime Nextgen advertises for the JWKS response (the `Cache-Control` max-age, a
  project-level config with a default of 5 min), so clients holding a cached copy have had a chance
  to pick up the new key before it signs.
  - `active_from` defaults to `now() + propagation_window` while the project already has an active
    key.
  - `active_from = now()` for the first key of the project, where no cached JWKS can exist yet, and
    for a key replacing a compromised one, where the risk of an unresolvable `kid` is preferable to
    the risk of continuing to sign with a key an attacker holds.
- **Grace period:** how long a key stays in the JWKS after its successor takes over.
  - It should be at least as long as the longest configured self-contained (access) token lifetime,
    so outstanding tokens expire before their `kid` leaves the JWKS.
  - It is derived from the project configuration.
- **Maximum active-key age:** how long a key keeps signing before it is replaced.
  - Exceeding it triggers rotation automatically.
  - Defined per project, defaulting to 30 days per
    [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#rotation).
  - Setting it to zero disables automatic rotation, leaving rotation a manual, admin-triggered
    action; a key then signs indefinitely, or until rotated manually.

The signing key, the JWKS contents, and each key's phase are all computed from `active_from` and
`retired_at` at read time:

- **Signing key:** the key whose `active_from` has passed and whose `retired_at` is null or still in
  the future (`active_from <= now()` and (`retired_at IS NULL` or `retired_at > now()`)).
- **Served in the JWKS:** from creation until one grace period after it retires
  (`retired_at IS NULL` or `retired_at + grace_period > now()`). A key that never retires stays
  indefinitely.
- **Purgeable:** once retired for at least the grace period (`retired_at + grace_period <= now()`),
  every token it signed has expired (based on the configuration for self-contained tokens) and the
  row can be deleted.

This rests on one invariant: `predecessor.retired_at = successor.active_from`. It is set when a
successor is created, must be moved if the successor's `active_from` is later moved, and must be
reset to null if the successor is deleted before it activates. Otherwise the predecessor would
retire on schedule with nothing behind it and signing would stall.

```
              old.retired_at = new.active_from
                          |
old:  ---- signs ---------|-------- grace --------|  (leaves JWKS, purgeable)
new:  --- published ------|-------- signs ---------------->
      ^
      |
      new key inserted; signs after propagation_window
```

#### Routine Signing Key Rotation

Rotation is triggered when a key's age exceeds the project's configured maximum or when an admin
triggers it manually.

1. Generate a new signing key pair and insert it with `active_from = now() + propagation_window`,
   and set the outgoing key's `retired_at` to that same instant. The new key is served in the JWKS
   immediately under a new `kid`; the old key remains present and keeps signing until then.
2. At `active_from` the new key becomes activated and starts signing.
3. The old key stays in the JWKS for the duration of the grace period after the handover, letting
   outstanding tokens expire.

Automatic and manual rotation differ only in who performs the insert:

- **Automatic:** a sweep finds projects whose current signing key is older than the project's
  maximum active-key age and which have no successor queued, and inserts one. Projects that set the
  age to zero are skipped, leaving that rotation to the admin.
- **Manual:** the admin calls the create endpoint. `active_from` defaults to
  `now() + propagation_window` and may be set later, but not earlier: a key that signs before the
  propagation window elapses risks an unresolvable `kid`. Moving it also moves the predecessor's
  `retired_at` to match. Only the emergency path sets `active_from = now()`.

#### Emergency Compromise Handling

If an active signing key is compromised:

1. Generate a new signing key pair and insert it with `active_from = now()`, which retires the
   compromised key at the same instant, so the replacement signs immediately.
2. Delete the compromised key. It leaves the JWKS and isn't chosen for signing.
3. Revoke the project's sessions and refresh tokens. These opaque tokens are encrypted under the DEK
   and are independent of the signing key, so the compromise does not affect them. Revoking them is
   a precaution against a broader breach, forcing re-authentication. PATs are out of scope in the
   current MVP ([ADR 032](032-token-lifecycle.md#personal-access-tokens)), and their exposure depends
   on their eventual token format ([Open Question 5](#questions)).

**Notes on key deletion:**

- Deletion has two sources. The purge sweep removes only keys already past
  `retired_at + grace_period`, which by construction are neither the signer nor still in grace. Any
  other deletion (the emergency path, or cancelling a queued successor) must refuse to remove the
  key currently matching the signing-key predicate above. The emergency path satisfies this by
  inserting the replacement first, which retires the compromised key before it is deleted;
  cancelling a not-yet-active successor is allowed but must reset its predecessor's `retired_at` to
  null.
- The exposure from a compromised signing key is forged _self-contained_ tokens (access tokens).
  Deleting the key removes it from the JWKS immediately, but clients holding a cached copy keep
  honoring the `kid` until their cache expires, so forged tokens remain accepted for at most one
  JWKS cache lifetime. Opaque tokens are unaffected by the key; revoking them (step 3) is a separate
  precaution.

### 6. Encryption-at-Rest Key Rotation

Nextgen's encryption-at-rest uses the KEK/DEK envelope per
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key). An asymmetric KEK wraps a
symmetric DEK, and the DEK performs the AES-GCM encryption of secrets at rest. KEK generation and
provisioning are out of scope for this document.

This document assumes one DEK per project, matching the per-project scope of signing keys in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#scope). A per-project DEK contains a
DEK-level compromise to a single project. If the KEK stays global
([Open Question 3](#questions)), a KEK compromise still reaches every DEK it wrapped, and the
emergency procedure below stays platform-wide. The procedures are written per project; a global DEK
would collapse each per-project step into one.

The DEK itself is not rotated on a schedule. It is only re-wrapped under a new KEK during routine
KEK rotation (below) and regenerated during emergency compromise handling. The DEK never leaves the
database and is only ever exposed in memory after a successful KEK unwrap.

#### Routine KEK Rotation

1. Supply a new KEK key pair through configuration and mark it as the wrapping key. Per
   [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key), more than one master key may
   be configured at a time, with exactly one marked for encryption and the rest usable for
   decryption only.
2. The previous KEK stays in configuration as a decrypt-only key, so its private key can still
   unwrap the DEKs stored under it.
3. For each project, unwrap the DEK with the old KEK private key, re-wrap it with the new KEK's
   public key, and update the wrapped DEK in the database.
4. Remove the old KEK from configuration once every project's DEK has been re-wrapped, since nothing
   is encrypted under it any longer.

#### Emergency KEK Compromise Handling

Per the key hierarchy in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#signingencryption-keys), the DEK protects
four classes of material: signing keys, opaque tokens, third-party secrets, and authenticator
secrets (TOTP shared secrets). Passwords and recovery codes are hashed and passkeys store only
public keys, so those are not exposed by a DEK compromise.

##### When a KEK is compromised

As the DEKs are stored in the database, when only the KEK is compromised, the DEKs are unaffected.
In this case, rotating the KEK and re-wrapping the DEKs is sufficient. Follow the steps in
[Routine KEK Rotation](#routine-kek-rotation) above to rotate the compromised KEK.

##### When a KEK and the database are both compromised

When both the KEK and the database are compromised, every DEK the KEK wrapped can be unwrapped, and
therefore every secret those DEKs protected is exposed in plaintext to whoever holds that database
copy. Re-encrypting those plaintexts under fresh DEKs restores confidentiality of the ciphertext but
does nothing for the secrets themselves. They must be rotated, not re-wrapped.

1. Provision a replacement KEK, generate a new DEK per project, and wrap each new DEK with the new
   KEK's public key.
2. **Signing keys.** Every project's signing key private half is compromised. Run the
   [emergency signing key procedure](#emergency-compromise-handling) for every project.
   Re-encrypting the old private halves under the new DEK is not sufficient.
3. **Opaque tokens.** Every session token and refresh token is forgeable. Revoke all of them
   platform-wide.
4. **Third-party secrets.** Stored IdP secrets and API keys are compromised. The platform cannot
   rotate these unilaterally, since they are issued by the third party. Two separate things have to
   happen:
   - _Rotate at source._ Operators must be notified so they can rotate each secret with the third
     party. The stored value is replaced once they do.
   - _Re-encrypt under the project's new DEK._ Rows left under the old DEK stay readable to whoever
     holds the compromised KEK, so a later copy of the database hands them every secret not yet
     rotated. It is a small migration: one row per configured IdP or API key.
5. **Authenticator secrets.** Every TOTP shared secret is exposed, so an attacker holding the
   database can compute valid codes. Invalidate all TOTP secrets and require affected users to
   re-enroll. Until they do, users fall back to their other factors, or to account recovery
   ([Section 4](#4-account-recovery)) if TOTP was their only second factor.
6. Once secrets in steps 4 and 5 are re-encrypted, remove the compromised KEK from configuration and
   destroy it at its source (for example, through the cert-manager or equivalent tooling that
   provisioned it). The KEK is supplied by config, so there is no in-application revocation
   mechanism to invoke.
7. Destroy the compromised DEKs once nothing references them.

This is not a more expensive version of routine rotation. Routine rotation re-wraps a value that was
never exposed. A KEK compromise is a full platform credential compromise, and step 4 in particular
has a recovery time bounded by third parties rather than by the platform.

## Consequences

Adopting these consolidated migration and recovery strategies introduces the following trade-offs:

### Positive

- The policies prioritize immediate neutralization of threats. A compromised signing key stops
  signing at once (though verifiers holding a cached JWKS lag by up to one cache lifetime), and
  compromised TOTP secrets are invalidated server-side immediately.
- Per-project signing keys with explicit, auditable lifecycles give tenants the key isolation and
  rotation evidence for compliance reasons, and support the per-project NIST/FIPS profiles
  in [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#nist).
- Multi-path account recovery (single-use codes and short-lived magic links) means losing one
  authentication factor is a recoverable event rather than a lockout.
- Routine KEK rotation ([Section 6](#6-encryption-at-rest-key-rotation)) is inexpensive because only
  wrapped DEKs are re-wrapped rather than every stored secret, and it keeps master-key lifecycle
  ownership on external infra tooling (e.g., cert-manager) rather than the application.

### Negative / Risks

- Recovery is not a guarantee against lockout. A user who loses both their recovery codes and their
  email access has no path back in. We accept that outcome because the only escape hatch would be
  letting support restore access.
- Magic-link recovery floors an account's security at the security of its email inbox, because it
  bypasses every enrolled factor. For an account otherwise protected by a passkey this is a
  downgrade. Projects that cannot accept that downgrade can disable magic-link recovery
  ([Section 4](#4-account-recovery)).
- Emergency KEK compromise handling in case of KEK and database compromise
  ([Section 6](#6-encryption-at-rest-key-rotation)) is not a larger routine rotation. It is a full
  platform credential compromise: every signing key must be rotated, every opaque token revoked, and
  every third-party secret re-issued by the third party that owns it. Recovery time is therefore
  partly outside the platform's control.

## Questions

1. During an account recovery event, what is the exact policy for invalidating a user's pre-existing
   active sessions and revoking outstanding refresh tokens? Does recovery revoke every session, or
   only the ones bound to the lost factor?

2. Should a retired signing key pair be kept as audit evidence past the point it is purgeable
   ([Section 5](#5-signing-key-lifecycle))? Section 5 already settles when a key becomes deletable:
   once it leaves the JWKS after its grace period, every self-contained token it signed has expired,
   so the row can be purged. The open question is only whether to retain the key pair beyond that as
   rotation/audit evidence, and for how long.

3. **(Resolved)** Should the KEK be per project as well as the DEK
   ([Section 6](#6-encryption-at-rest-key-rotation))? A per-project KEK would contain even a KEK
   compromise to one project, closing the gap a per-project DEK under a global KEK leaves open. But
   the KEK is provisioned externally (cert-manager, per
   [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key)), so one KEK per project
   means provisioning and rotating a key pair per tenant through that external tooling, and coupling
   tenant onboarding to it.

   **Answer:** The KEK stays global and externally provisioned for now; the per-project DEK remains
   the isolation boundary.

4. Should an explicit status column supplement the `retired_at` model
   ([Section 5](#5-signing-key-lifecycle))? Section 5 decides the lifecycle state is the two
   timestamps `active_from` and `retired_at`, with signing, grace, and expiry all derived at read
   time. The open part is only whether to _also_ store an explicit active/retiring/retired column,
   as sketched in issue [#509](https://github.com/zitadel/nextgen/issues/509), as a convenience for
   querying and auditing.
   - Against: the column is redundant with the timestamps, a background job must transition it, and
     it can drift out of sync with reality.
   - For: it is easier to query and audit directly without recomputing the predicates.

   Either way, the derived timestamps remain the source of truth, and both still need a sweep to
   rotate keys and purge expired ones. Whether to add the column is open.

5. How does a compromised or rotated signing key interact with PATs once they come into scope
   ([ADR 032](032-token-lifecycle.md#personal-access-tokens) defers them)? If opaque, the DEK
   protects them like a session or refresh token; if self-contained, a signing-key compromise can
   forge them. If PATs can live indefinitely, what is the policy for retiring the keys that signed
   them, and do we need a max cap (product decision)?

## Follow-up work

1. Password rehash persistence ([Section 1](#1-password-rehashing-and-migration)).
2. `signing_keys` schema ([Section 5](#5-signing-key-lifecycle)).
3. Signing key rotation mechanics, including the JWKS endpoint and the autorotation sweep
   ([Routine Signing Key Rotation](#routine-signing-key-rotation)).
4. Purging retired signing keys once their grace period has elapsed
   ([Section 5](#5-signing-key-lifecycle)).
5. Recovery code generation / consumption flow ([Recovery Codes](#recovery-codes)).
6. Magic-link recovery flow, including the email-sending infrastructure it depends on
   ([Magic Links](#magic-links)).
7. Setup needed for encryption-at-rest key rotation
   ([Section 6](#6-encryption-at-rest-key-rotation)): tracked in
   https://github.com/zitadel/nextgen/issues/505
