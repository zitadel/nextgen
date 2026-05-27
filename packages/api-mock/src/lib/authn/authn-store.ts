/**
 * Unified mock authentication store for the flow API server.
 *
 * A real RP splits authentication into two concerns backed by separate
 * database tables: a **user-account table** (does this address exist? is the
 * credential valid?) and a **WebAuthn credential table** (which authenticators
 * has this user enrolled?). `AuthnStore` models both in memory so the mock
 * server can reproduce every Figma error-state screen and the full passkey
 * enrol-then-login journey without any database or network calls.
 *
 * **User accounts** — a fixed set of "known addresses" that produce
 * deterministic error responses. Adding a new test scenario is a one-liner
 * in the relevant constant map; no handler changes are required.
 *
 * **WebAuthn credentials** — a mutable store keyed on both user handle and
 * credential ID, matching the two lookup paths the W3C WebAuthn spec
 * mandates. Sign-count is incremented on every `authenticate()` call
 * (spec §7.2 step 17). Credentials survive `createFlow` actor resets because
 * credentials outlive individual login sessions in a real system; they are
 * wiped when the caller invokes `MockHandle.reset()`.
 *
 * One `AuthnStore` instance is created per `setupMockHandlers()` closure so
 * parallel test suites never share state.
 */

/**
 * Subset of `AuthenticatorTransport` values from the W3C WebAuthn spec.
 *
 * Stored alongside each credential and echoed back in `allowCredentials` so
 * the browser can skip authenticators that are not currently reachable (e.g.
 * hiding a USB security-key entry on a device without USB ports).
 */
export type AuthenticatorTransport =
  | "usb"
  | "nfc"
  | "ble"
  | "smart-card"
  | "hybrid"
  | "internal";

/**
 * A single registered WebAuthn credential, mirroring the columns a production
 * RP would persist after successful attestation verification.
 */
export type StoredCredential = {
  /** base64url credential ID as returned by `PublicKeyCredential.id`. */
  credentialId: string;
  /**
   * Opaque user identifier — the email address typed at the identifier step
   * in this mock.
   */
  userHandle: string;
  /**
   * COSE public key extracted from the attestation object.
   *
   * The mock never verifies assertion signatures, so this is a static
   * placeholder rather than the real encoded key bytes. A real RP would store
   * the output of `AuthenticatorAttestationResponse.getPublicKey()` here.
   */
  publicKey: string;
  /**
   * Signature counter. Starts at `0` on registration; incremented by one on
   * every successful `authenticate()` call.
   *
   * A real RP rejects any assertion whose counter does not exceed this stored
   * value (replay-attack protection, W3C WebAuthn §7.2 step 17).
   */
  signCount: number;
  /**
   * Transport hints for this authenticator, used to populate
   * `PublicKeyCredentialDescriptor.transports` in `allowCredentials` on
   * future challenges.
   *
   * The mock infers these from `authenticatorAttachment` in the proof because
   * `AuthenticatorAttestationResponse.getTransports()` is not included in the
   * serialised proof shape that `<zl-passkey>` emits.
   */
  transports: AuthenticatorTransport[];
  /** ISO 8601 timestamp when the credential was first registered. */
  createdAt: string;
  /**
   * ISO 8601 timestamp of the most recent successful assertion, or `null` if
   * the credential has never been used for authentication.
   */
  lastUsedAt: string | null;
};

/**
 * The relevant fields from the serialised `PublicKeyCredential` that the
 * browser returns after a WebAuthn ceremony and the orchestrator forwards in
 * `challenge_response.proof`.
 *
 * This is intentionally narrower than `ZlPasskeyResultDetail["proof"]` —
 * `AuthnStore` only needs the credential ID and attachment hint.
 */
export type PasskeyProof = {
  /**
   * base64url credential ID (`PublicKeyCredential.id`).
   * Absent when the browser returned no credential.
   */
  id?: string;
  /**
   * Whether the authenticator is bound to the device (`"platform"`) or
   * external (`"cross-platform"`).
   *
   * Used to infer transport hints during registration because
   * `getTransports()` is not exposed in the serialised proof.
   */
  authenticatorAttachment?: string;
};

/**
 * Emails that trigger a **field-level error** on the register step.
 * Models the "account already exists" path (Figma `6593:141741`).
 */
const REGISTRATION_ERRORS: ReadonlyMap<string, string> = new Map([
  ["exists@example.com", "error.email_exists"],
]);

/**
 * Emails that trigger an error on the **identifier** step.
 *
 * - `wrong@example.com`  → wrong credentials (Figma `6602:180268`).
 * - `server@example.com` → server-side failure (Figma `6594:125237`).
 */
const LOGIN_ERRORS: ReadonlyMap<string, string> = new Map([
  ["wrong@example.com", "error.invalid_credentials"],
  ["server@example.com", "error.sign_in_server"],
]);

/**
 * Emails that trigger a **form-level error** on the passkey-upsell step when
 * the user attempts to enrol a passkey (Figma `6594:630`).
 */
const PASSKEY_UPSELL_ERRORS: ReadonlyMap<string, string> = new Map([
  ["passkey-cancel@example.com", "error.passkey_cancelled"],
  ["passkey-unsupported@example.com", "error.passkey_unsupported"],
  ["passkey-fail@example.com", "error.passkey_failed"],
]);

/**
 * Unified mock authentication store.
 *
 * Combines user-account error fixtures and WebAuthn credential storage into a
 * single object. See the module-level JSDoc for the full design rationale.
 */
export class AuthnStore {
  private readonly byUser = new Map<string, StoredCredential[]>();
  private readonly byId = new Map<string, StoredCredential>();

  /**
   * Return the i18n error key to surface on the **register** step for
   * `email`, or `null` if the address is not a known error fixture.
   *
   * @param email - The email typed by the user; compared case-insensitively.
   * @returns The i18n error key, or `null`.
   *
   * @example
   * authn.registrationError("exists@example.com") // → "error.email_exists"
   * authn.registrationError("new@example.com")     // → null
   */
  registrationError(email: string): string | null {
    return REGISTRATION_ERRORS.get(email.toLowerCase()) ?? null;
  }

  /**
   * Return the i18n error key to surface on the **identifier** step for
   * `email`, or `null` if the address is not a known error fixture.
   *
   * @param email - The email typed by the user; compared case-insensitively.
   * @returns The i18n error key, or `null`.
   *
   * @example
   * authn.loginError("wrong@example.com")  // → "error.invalid_credentials"
   * authn.loginError("server@example.com") // → "error.sign_in_server"
   * authn.loginError("user@example.com")   // → null
   */
  loginError(email: string): string | null {
    return LOGIN_ERRORS.get(email.toLowerCase()) ?? null;
  }

  /**
   * Return the i18n error key to surface on the **passkey-upsell** step for
   * `email` when the user attempts to enrol, or `null` if the address is not
   * a known error fixture.
   *
   * @param email - The email captured at the identifier step; compared
   *   case-insensitively.
   * @returns The i18n error key, or `null`.
   *
   * @example
   * authn.passkeyUpsellError("passkey-cancel@example.com")      // → "error.passkey_cancelled"
   * authn.passkeyUpsellError("passkey-unsupported@example.com") // → "error.passkey_unsupported"
   * authn.passkeyUpsellError("user@example.com")                // → null
   */
  passkeyUpsellError(email: string): string | null {
    return PASSKEY_UPSELL_ERRORS.get(email.toLowerCase()) ?? null;
  }

  /**
   * Persist a new WebAuthn credential for `userHandle`.
   *
   * In a real RP this is called after verifying the attestation object and
   * confirming the credential ID is not already registered. The mock stores
   * unconditionally — if `credentialId` already exists for this user, the old
   * entry is replaced in both indexes (no duplicates in `getByUser()` results).
   *
   * @param userHandle   - Opaque user identifier (email in this mock).
   * @param credentialId - base64url credential ID from `PublicKeyCredential.id`.
   * @param transports   - Transport hints; defaults to `["internal"]`.
   * @returns The newly stored credential record.
   */
  register(
    userHandle: string,
    credentialId: string,
    transports: AuthenticatorTransport[] = ["internal"],
  ): StoredCredential {
    const cred: StoredCredential = {
      credentialId,
      userHandle,
      publicKey: "mock-public-key",
      signCount: 0,
      transports,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
    };
    // Filter out any existing entry for this credentialId before appending so
    // that re-registration replaces rather than duplicates the record in the
    // per-user list (byId is overwritten by Map.set, which is already correct).
    const existing = (this.byUser.get(userHandle) ?? []).filter(
      (c) => c.credentialId !== credentialId,
    );
    this.byUser.set(userHandle, [...existing, cred]);
    this.byId.set(credentialId, cred);
    return cred;
  }

  /**
   * Register a credential directly from the serialised passkey proof that the
   * browser returns after a successful `navigator.credentials.create()`
   * ceremony.
   *
   * Transport hints are inferred from `proof.authenticatorAttachment` because
   * `AuthenticatorAttestationResponse.getTransports()` is not present in the
   * serialised proof shape emitted by `<zl-passkey>`:
   *
   * - `"platform"` (Touch ID, Windows Hello) → `["internal"]`
   * - `"cross-platform"` (USB security key)   → `["usb", "ble", "nfc"]`
   * - absent                                  → `["internal"]` (safe default)
   *
   * The `"hybrid"` transport (synced passkey via phone) is not inferred here
   * because the spec does not distinguish it from `"cross-platform"` via the
   * `authenticatorAttachment` field at registration time. Callers may use
   * `register()` directly and supply `["hybrid"]` if needed.
   *
   * @param userHandle - Opaque user identifier (email in this mock).
   * @param proof      - Serialised proof from the browser ceremony.
   * @returns The newly stored credential, or `null` when `proof.id` is absent.
   */
  registerFromProof(userHandle: string, proof: PasskeyProof): StoredCredential | null {
    if (!proof.id) return null;
    const transports: AuthenticatorTransport[] =
      proof.authenticatorAttachment === "cross-platform"
        ? ["usb", "ble", "nfc"]
        : ["internal"];
    return this.register(userHandle, proof.id, transports);
  }

  /**
   * Return all credentials registered for `userHandle`, in registration
   * order.
   *
   * Used to build `allowCredentials` on authentication challenges — supplying
   * the list tells the browser exactly which authenticators to surface, giving
   * the user a tighter, less-confusing picker.
   *
   * @param userHandle - Opaque user identifier (email in this mock).
   * @returns Zero or more credential records; never throws.
   */
  getByUser(userHandle: string): StoredCredential[] {
    return this.byUser.get(userHandle) ?? [];
  }

  /**
   * Look up a single credential by its base64url ID.
   *
   * @param credentialId - base64url credential ID from `PublicKeyCredential.id`.
   * @returns The matching credential, or `undefined` if not found.
   */
  getById(credentialId: string): StoredCredential | undefined {
    return this.byId.get(credentialId);
  }

  /**
   * Record a successful assertion for `credentialId`.
   *
   * Increments `signCount` by one (replay-attack protection, W3C WebAuthn
   * §7.2 step 17) and stamps `lastUsedAt` with the current time.
   *
   * Both indexes (`byId` and `byUser`) hold a reference to the same object, so
   * the mutation is visible through either lookup path — no secondary update
   * is required.
   *
   * @param credentialId - base64url credential ID from the assertion.
   * @returns The updated credential record, or `undefined` if the ID is not
   *   registered.
   */
  authenticate(credentialId: string): StoredCredential | undefined {
    const cred = this.byId.get(credentialId);
    if (!cred) return undefined;
    cred.signCount += 1;
    cred.lastUsedAt = new Date().toISOString();
    return cred;
  }

  /**
   * Record authentication from the serialised passkey proof returned by
   * `navigator.credentials.get()`.
   *
   * Extracts `proof.id` and delegates to {@link authenticate}. Returns `null`
   * when the proof carries no ID or the ID is not registered.
   *
   * @param proof - Serialised proof from the browser assertion ceremony.
   * @returns The updated credential record, or `null`.
   */
  authenticateFromProof(proof: PasskeyProof): StoredCredential | null {
    if (!proof.id) return null;
    return this.authenticate(proof.id) ?? null;
  }

  /**
   * Wipe all stored credentials.
   *
   * Invoked by `MockHandle.reset()` so each test suite starts from a clean
   * state. User-account fixture maps are module-level constants and are not
   * affected by this call.
   */
  clear(): void {
    this.byUser.clear();
    this.byId.clear();
  }
}
