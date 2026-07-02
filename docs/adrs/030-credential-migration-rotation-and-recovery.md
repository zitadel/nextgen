# ADR 030: Credential Migration, Rotation, and Recovery

> **Status:** Proposed
> **Date:** 2026-07-01
> **Context:** credential migration, rotation, and recovery flows

## Context

This document defines the standard operating procedures for credential migration and rotation, account recovery flows, and emergency key compromise handling. The primary objective of these policies is to prevent irreversible security exposures while ensuring legitimate users are not accidentally locked out of their accounts during routine security lifecycle events.

## Decision

### 1. Password Rehashing and Migration
The system leverages `passwap.Swapper` combined with the `password_hasher` configuration to handle both parameter upgrades (rehashing) and complete algorithmic switches (migration).

* **The Flow:** When a user logs in, the provided password is verified against the stored hash. `(*passwap.Swapper).Verify` returns `(upgradedEncodedHash, error)`; when it returns an upgraded hash for parameter upgrades or algorithm migration, the server MUST persist that upgraded hash to the database.

### 2. Passkey Migration
Unlike passwords, passkeys (asymmetric keys) cannot be transparently rehashed or migrated by the server.

* **Soft Enrollment Nudge:** The system will prompt users to register a second passkey after their first successful passkey authentication if they have fewer than two enrolled. This prompt is a dismissible "soft nudge," not a strict gate.
* **Device Change:** The user registers a new passkey on the new device. They may manually revoke the old passkey if it is no longer necessary.
* **Deregistration Safeguards:** If a user attempts to deregister their final passkey, they must first register a new passkey or set up an alternative authentication method. This guarantees the account always retains at least one strong factor.
* **Device Loss:** Users regain access via configured account recovery methods (see [Section 4](#4-account-recovery)). Upon successful recovery, the system immediately prompts the user to revoke the lost passkey and register a replacement.

#### 2.1 RP ID Migration (Domain Changes)
Passkey credentials are cryptographically bound to the WebAuthn Relying Party ID (`rpId`). Changing the domain typically invalidates all registered passkeys. To handle this gracefully, the system will:
* Utilize [**Related Origin Requests (ROR)**](https://passkeys.dev/docs/advanced/related-origins/) to allow existing passkeys to continue working across a limited set of related origins for a transition period.
* Prompt users during this transition window to automatically re-register their passkeys under the new `rpId`.

### 3. TOTP Enrollment and Rotation
Rotating a TOTP secret mandates invalidating the current shared secret and establishing a new one.

* **Device Change:** When registering a new device to replace an old one, the new TOTP secret replaces the old one. Remove the existing TOTP configuration and register a new one.
* **Device Loss:** In the event of device loss or compromise, the user authenticates via a recovery method (see [Section 4](#4-account-recovery)). Upon successful recovery, the system immediately prompts the user to re-register their TOTP secret.

### 4. Account Recovery
Account recovery acts as the fallback mechanism when a user's primary authentication factor (Passkey, TOTP) is lost or compromised.

#### 4.1 Recovery Codes
* A set of static recovery codes is generated and cryptographically hashed during the user's initial MFA enrollment.
* Each code is strictly single-use.

#### 4.2 Magic Links
* A single-use magic link is generated and sent to the user's verified email address.
* Links enforce a strict, configurable expiration window (e.g., 15 minutes) and are only valid for a single use.

> **Post-Recovery Requirement:** The user should be prompted to re-register their lost authentication factors (Passkey, TOTP, etc.) to ensure they have at least one valid factor for future logins.

### 5. Signing Key Lifecycle
*(Note: The `signing_keys` database table schema is yet to be defined, but will include `active_from` and `active_until` timestamps to track signing validity.)*
The public JWKS endpoint dynamically serves all keys that are currently valid for token verification.

#### 5.1 Routine Signing Key Rotation

To rotate a key without breaking active user sessions:

1. Generate a new signing key pair and insert it into `signing_keys` with `active_from = now()`.
2. Publish the new public key to the JWKS endpoint under a new `kid`. The old key remains present.
3. Transition the system to sign all new tokens with the newly generated key.
4. To retire the old key, set `active_until = now()`.
5. The old public key must remain in the JWKS endpoint for an additional grace period (equal to the maximum token
   lifespan) to allow outstanding tokens to safely expire. It is removed from the JWKS only after this grace period
   elapses.

#### 5.2 Emergency Compromise Handling
If an active signing key is compromised:
1.  Immediately set `active_until = now()` on the compromised key and remove its public key from the JWKS endpoint. This prevents verification of tokens with that `kid` once verifiers refresh JWKS; revoke sessions/refresh tokens as part of the incident response.
2.  Generate and publish a replacement key pair to resume operations and force clients to re-authenticate.

### 6. Encryption-at-rest key rotation
For data encrypted at rest (e.g., TOTP secrets, OAuth client secrets), key rotation is necessary to limit the amount of data protected by a single key and to recover from potential key compromise.

Today, the configured `server.encryption_key` is used for sealing server-managed payloads (e.g., flow cookies and opaque tokens) via AES-256-GCM (`crypto.Crypter`). This ADR proposes an explicit envelope-encryption approach for any database-stored secrets that require encryption at rest.
Instead of loading a raw 32-byte key directly from a file, the server loads an encrypted **Global Data Encryption Key (DEK)** that is wrapped by a Key Encryption Key (KEK) managed by a Key Management Service (AWS KMS, Google Cloud KMS, or HashiCorp Vault).

**The Lifecycle:**
1.  **Startup:** On boot, the system reads the KMS-encrypted DEK, calls the KMS provider to decrypt it into active memory, and uses this plaintext DEK to initialize the standard `crypto.Crypter`.
2.  **Rotation (Shallow):** Administrators rotate the Master KEK within the KMS, which re-wraps the Global DEK payload. Because the underlying Global DEK remains mathematically identical, the encrypted database rows require zero updates.

**Trade-offs:**
* **Pros:** Key rotation is instantaneous, requires no database migrations, centralizes auditing, and leaves existing codebase interfaces unchanged.
* **Cons:** Introduces a hard dependency on an external KMS provider. Furthermore, this pattern only rotates the Master Key (KEK). If the active Global DEK is leaked from server memory, a **Deep Rotation** (a full database migration to decrypt and re-encrypt all data with a new DEK) is still required.

> **Local Development:** For local or offline environments, the system supports injecting a static, unencrypted key directly as a fallback.

### 7. Consequences

Adopting these consolidated migration and recovery strategies introduces the following trade-offs:

**Pros:**
* By enforcing a strict teardown/rebuild for TOTP and utilizing Envelope Encryption for data-at-rest, we avoid building complex, stateful transition flows and eliminate the need for massive, risky database migrations.
* The policies prioritize immediate neutralization of threats. Compromised signing keys are instantly evicted, and lost TOTP devices are immediately invalidated.
* The explicit key lifecycles (active/retired/grace periods) and the integration of an external KMS satisfy strict compliance and auditing standards (e.g., SOC 2, PCI-DSS) out of the box.
* Combining automated password rehashing with robust, multi-path account recovery (single-use codes and short-lived magic links) ensures users are never permanently locked out of their accounts.

**Cons:**
* Increased UX Friction (TOTP): If a user experiences a network failure or browser crash mid-setup, their previous configuration is already invalid. They will be forced to use other factors or a fallback recovery method to gain access.
* The Envelope Encryption pattern introduces a hard infrastructure dependency on a third-party KMS provider, requiring network calls on server boot and specific IAM configurations.
* While routine KMS rotation is instantaneous, the architecture accepts the risk that an in-memory leak of the Global DEK still requires a highly disruptive, manual database migration to resolve.

### Open Questions
1. The database schema for `signing_keys` is not yet defined/implemented.
2. Does routine signing key rotation need to be automated internally (e.g., via background workers)?
3. During an account recovery event, what is the exact policy for invalidating a user's pre-existing active sessions and revoking outstanding refresh tokens?