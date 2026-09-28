# ADR 039: Signing Key Rotation and Incident Response

> **Status:** Proposed
> **Date:** 2026-07-15
> **Context:** signing-key lifecycle, key rotation, and compromise handling

## Context

This document defines the lifecycle and rotation of the platform's cryptographic keys, the
per-project signing keys and the encryption-at-rest master-key/KEK envelope, together with the emergency
procedures for handling their compromise. It builds on the key hierarchy and rotation policy in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md).

## Decision

### 1. Signing Key Lifecycle

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
  every self-contained token it signed has expired and the row can be deleted. Long-lived opaque
  tokens signed by the same key are an open point (see [Question 1](#questions)).

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
3. The project's sessions and refresh tokens may also be revoked. These opaque tokens are signed by
   the same key but also encrypted under the project's token encryption key, so a signing-key
   compromise alone cannot forge them: an attacker would also need that key. Revoking them is a
   precaution against a broader breach, forcing
   re-authentication. PATs are out of scope in the
   current MVP ([ADR 037](037-token-lifecycle.md#personal-access-tokens)), and their exposure depends
   on their eventual token format ([Open Question 4](#questions)).

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
  JWKS cache lifetime. Opaque tokens are signed by the key too but cannot be forged without the
  token encryption key, so this compromise does not expose them; revoking them (step 3) is a separate
  precaution.

### 2. Encryption-at-Rest Key Rotation

Nextgen's encryption-at-rest uses the envelope defined in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key). An asymmetric master key wraps
a symmetric key encryption key (KEK) per project, that KEK wraps the project's purpose-scoped keys
(token, secret and cookie encryption, plus the signing keys), and those purpose-scoped keys perform
the AES-GCM encryption of secrets at rest. Master-key generation and provisioning are out of scope
for this document.

Each project has exactly one active KEK, matching the per-project scope of signing keys in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#scope). A per-project KEK contains a
KEK-level compromise to a single project. The master key stays global
([Question 2](#questions)), so a master-key compromise still reaches every KEK it wrapped, and the
emergency procedure below stays platform-wide. The procedures are written per project.

Because each class of data has its own key, a purpose-scoped key can be rotated on its own without
touching anything the other keys protect. Rotating the token encryption key, for instance, does not
re-encrypt third-party secrets.

Neither the KEK nor the purpose-scoped keys are rotated on a schedule. The KEK is re-wrapped under a
new master key during routine master-key rotation (below) and regenerated during emergency
compromise handling. It never leaves the database and is only ever exposed in memory after a
successful master-key unwrap.

#### Routine Master Key Rotation

1. Supply a new master key pair through configuration and mark it as the wrapping key. Per
   [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key), more than one master key may
   be configured at a time, with exactly one marked for encryption and the rest usable for
   decryption only.
2. The previous master key stays in configuration as a decrypt-only key, so its private key can still
   unwrap the KEKs stored under it.
3. For each project, unwrap the KEK with the old master key's private key, re-wrap it with the new
   master key's public key, and update the wrapped KEK in the database. The purpose-scoped keys stay
   untouched: they are wrapped by the KEK, not by the master key.
4. Remove the old master key from configuration once every project's KEK has been re-wrapped, since
   nothing is encrypted under it any longer.

#### Emergency Master Key Compromise Handling

Per the key hierarchy in
[ADR 029](029-cryptography-secrets-and-key-lifecycle.md#signingencryption-keys), a project's KEK
transitively protects four classes of material through its purpose-scoped keys: signing keys, opaque
tokens, third-party secrets, and authenticator secrets (TOTP shared secrets). Passwords and recovery
codes are hashed and passkeys store only public keys, so those are not exposed by a key compromise.

##### When a master key is compromised

As the KEKs are stored in the database, when only the master key is compromised, the KEKs are
unaffected. In this case, rotating the master key and re-wrapping the KEKs is sufficient. Follow the
steps in [Routine Master Key Rotation](#routine-master-key-rotation) above to rotate the compromised
master key.

##### When a master key and the database are both compromised

When both the master key and the database are compromised, every KEK the master key wrapped can be
unwrapped, and therefore every secret those KEKs transitively protected is exposed in plaintext to
whoever holds that database copy. Re-encrypting those plaintexts under fresh keys restores
confidentiality of the ciphertext but does nothing for the secrets themselves. They must be rotated,
not re-wrapped.

1. Provision a replacement master key, generate a new KEK and a new set of purpose-scoped keys per
   project, and wrap each new KEK with the new master key's public key.
2. **Signing keys.** Every project's signing key private half is compromised. Run the
   [emergency signing key procedure](#emergency-compromise-handling) for every project.
   Re-encrypting the old private halves under the new KEK is not sufficient.
3. **Opaque tokens.** Every session token and refresh token is forgeable. Revoke all of them
   platform-wide.
4. **Third-party secrets.** Stored IdP secrets and API keys are compromised. The platform cannot
   rotate these unilaterally, since they are issued by the third party. Two separate things have to
   happen:
   - _Rotate at source._ Operators must be notified so they can rotate each secret with the third
     party. The stored value is replaced once they do.
   - _Re-encrypt under the project's new secret encryption key._ Rows left under the old key stay
     readable to whoever holds the compromised master key, so a later copy of the database hands them
     every secret not yet rotated. It is a small migration: one row per configured IdP or API key.
5. **Authenticator secrets.** Every TOTP shared secret is exposed, so an attacker holding the
   database can compute valid codes. Invalidate all TOTP secrets and require affected users to
   re-enroll. Until they do, users fall back to their other factors, or to account recovery
   ([ADR 038, Section 4](038-user-credential-migration-and-recovery.md#4-account-recovery)) if TOTP
   was their only second factor.
6. Once secrets in steps 4 and 5 are re-encrypted, remove the compromised master key from
   configuration and destroy it at its source (for example, through the cert-manager or equivalent
   tooling that provisioned it). The master key is supplied by config, so there is no in-application
   revocation mechanism to invoke.
7. Destroy the compromised KEKs and purpose-scoped keys once nothing references them.

This is not a more expensive version of routine rotation. Routine rotation re-wraps a value that was
never exposed. A master key compromise is a full platform credential compromise, and step 4 in particular
has a recovery time bounded by third parties rather than by the platform.

## Consequences

### Positive

- The policies prioritize immediate neutralization of threats. A compromised signing key stops
  signing at once (though verifiers holding a cached JWKS lag by up to one cache lifetime), and
  compromised TOTP secrets are invalidated server-side immediately.
- Per-project signing keys with explicit, auditable lifecycles give tenants the key isolation and
  rotation evidence for compliance reasons, and support the per-project NIST/FIPS profiles
  in [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#nist).
- Routine master key rotation ([Section 2](#2-encryption-at-rest-key-rotation)) is inexpensive
  because only the wrapped per-project KEKs are re-wrapped rather than every stored secret, and it
  keeps master-key lifecycle ownership on external infra tooling (e.g., cert-manager) rather than the
  application.
- Purpose-scoped keys under the project KEK keep the blast radius and the cost of a rotation
  proportional to the class of data affected: rotating the token encryption key does not re-encrypt
  third-party secrets, and vice versa.

### Negative / Risks

- Emergency master key compromise handling in case of master key and database compromise
  ([Section 2](#2-encryption-at-rest-key-rotation)) is not a larger routine rotation. It is a full
  platform credential compromise: every signing key must be rotated, every opaque token revoked, and
  every third-party secret re-issued by the third party that owns it. Recovery time is therefore
  partly outside the platform's control.

## Questions

1. When is a retired signing key pair actually purgeable, and should it be kept past that point
   ([Section 1](#1-signing-key-lifecycle))? Two open points:
   - Section 1 derives the grace/purge window from the self-contained (access) token lifetime. But
     opaque refresh tokens are long-lived (weeks, per [ADR 037](037-token-lifecycle.md)) and are also
     signed by the same key. If validating them re-checks that signature against the stored key,
     purging on the access-token clock removes a key still needed to verify unexpired refresh tokens.
     Open: are opaque tokens verified by `jti` lookup alone, or must the purge window cover the
     longest token lifetime?
   - Whether to retain the key pair past purgeable as rotation/audit evidence, and for how long.

2. **(Resolved)** Should the master key be per project as well as the KEK
   ([Section 2](#2-encryption-at-rest-key-rotation))? A per-project master key would contain even a
   master-key compromise to one project, closing the gap a per-project KEK under a global master key
   leaves open. But the master key is provisioned externally (cert-manager, per
   [ADR 029](029-cryptography-secrets-and-key-lifecycle.md#master-key)), so one master key per
   project means provisioning and rotating a key pair per tenant through that external tooling, and
   coupling tenant onboarding to it.

   **Answer:** The master key stays global and externally provisioned for now; the per-project KEK
   remains the isolation boundary.

3. Should an explicit status column supplement the `retired_at` model
   ([Section 1](#1-signing-key-lifecycle))? Section 1 decides the lifecycle state is the two
   timestamps `active_from` and `retired_at`, with signing, grace, and expiry all derived at read
   time. The open part is only whether to _also_ store an explicit active/retiring/retired column,
   as sketched in issue [#509](https://github.com/zitadel/nextgen/issues/509), as a convenience for
   querying and auditing.
   - Against: the column is redundant with the timestamps, a background job must transition it, and
     it can drift out of sync with reality.
   - For: it is easier to query and audit directly without recomputing the predicates.

   Either way, the derived timestamps remain the source of truth, and both still need a sweep to
   rotate keys and purge expired ones. Whether to add the column is open.

4. How does a compromised or rotated signing key interact with PATs once they come into scope
   ([ADR 037](037-token-lifecycle.md#personal-access-tokens) defers them)? If opaque, the token
   encryption key protects them like a session or refresh token; if self-contained, a signing-key
   compromise can
   forge them. If PATs can live indefinitely, what is the policy for retiring the keys that signed
   them, and do we need a max cap (product decision)?

## Follow-up work

1. `signing_keys` schema ([Section 1](#1-signing-key-lifecycle)).
2. Signing key rotation mechanics, including the JWKS endpoint and the autorotation sweep
   ([Routine Signing Key Rotation](#routine-signing-key-rotation)).
3. Purging retired signing keys once their grace period has elapsed
   ([Section 1](#1-signing-key-lifecycle)).
4. Setup needed for encryption-at-rest key rotation
   ([Section 2](#2-encryption-at-rest-key-rotation)): tracked in
   https://github.com/zitadel/nextgen/issues/505