import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { bufferToBase64Url, base64UrlToBuffer } from "../internal/base64url.js";
import type { AtomManifest } from "../manifest.js";

import "./zl-alert.js";
import "./zl-button.js";

/**
 * Detail shape emitted by the `zl-passkey-result` event.
 *
 * Mirrors the `passkey-proof.yaml` schema (serialized PublicKeyCredential)
 * plus the `challenge_id` the orchestrator needs for the submit body.
 */
export type ZlPasskeyResultDetail = {
  challenge_id: string;
  method: string;
  proof: {
    id: string;
    rawId: string;
    type: "public-key";
    response: {
      clientDataJSON: string;
      attestationObject?: string;
      authenticatorData?: string;
      signature?: string;
      userHandle?: string;
    };
    authenticatorAttachment?: "platform" | "cross-platform";
  };
};

/**
 * Detail shape emitted by the `zl-passkey-error` event.
 *
 * `aborted` covers both programmatic aborts and the browser's
 * `NotAllowedError` (user dismissed the prompt — or the ceremony timed
 * out, which browsers report identically). `timed_out` refines that:
 * true when the rejection arrived at/after the server's `options.timeout`,
 * so callers can show timeout copy instead of "cancelled".
 */
export type ZlPasskeyErrorDetail = {
  challenge_id: string;
  error: string;
  aborted: boolean;
  timed_out: boolean;
};

/**
 * Detail shape emitted by the `zl-passkey-started` event, fired when the
 * WebAuthn ceremony actually begins (after the support/options guards).
 */
export type ZlPasskeyStartedDetail = {
  challenge_id: string;
  method: string;
};

/**
 * Slack subtracted from `options.timeout` when classifying a
 * `NotAllowedError` as a timeout: browsers clamp and fire the deadline
 * slightly early, so an exact comparison would label real timeouts as
 * user cancellations.
 */
const TIMEOUT_GRACE_MS = 1000;

/**
 * Atom: `<zl-passkey>` — WebAuthn ceremony handler.
 *
 * It is mounted by the Liquid template when
 * `step.challenge.type === "passkey"`. On mount, it reads the challenge
 * options from attributes, triggers the appropriate `navigator.credentials`
 * ceremony, and emits the result.
 *
 * While the ceremony is in flight it renders a small pending UI (status
 * line + cancel button) into its light DOM — light DOM so the markup the
 * orchestrator renders through `unsafeHTML` stays byte-identical and the
 * step subtree is never rebuilt mid-ceremony (a rebuild would reconnect
 * this atom and restart the ceremony). Set `silent` to suppress the
 * pending UI entirely.
 *
 * The orchestrator listens for `zl-passkey-result` to auto-submit the
 * proof via `challenge_response` on the flow submit body.
 *
 * Two modes:
 * - `ceremony="authenticate"` → `navigator.credentials.get()` (login)
 * - `ceremony="register"` → `navigator.credentials.create()` (registration)
 *
 * The options are passed as a JSON string via the `options` attribute (or
 * as a JS object via the `.options` property). These are the
 * `PublicKeyCredentialRequestOptions` or `PublicKeyCredentialCreationOptions`
 * straight from the server's challenge response.
 *
 * Spec: ADR 011 — Passkey Action Contract
 */
@customElement("zl-passkey")
export class ZlPasskey extends LitElement {
  /**
   * Which WebAuthn ceremony to perform.
   * - `authenticate` → `navigator.credentials.get()` (default, login)
   * - `register` → `navigator.credentials.create()` (passkey enrollment)
   */
  @property() accessor ceremony: "authenticate" | "register" = "authenticate";

  /**
   * Server-side challenge identifier. Echoed back in the result event
   * so the orchestrator can include it in `challenge_response.challenge_id`.
   */
  @property({ attribute: "challenge-id" }) accessor challengeId = "";

  /**
   * WebAuthn options from the server. Accepts either:
   * - A JSON string (via HTML attribute)
   * - A JS object (via property binding)
   *
   * For `ceremony="authenticate"`: `PublicKeyCredentialRequestOptions`
   * For `ceremony="register"`: `PublicKeyCredentialCreationOptions`
   */
  @property({
    attribute: "options",
    converter: {
      fromAttribute(value: string | null) {
        if (!value) return null;
        try {
          return JSON.parse(value) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      toAttribute(value: Record<string, unknown> | null) {
        return value ? JSON.stringify(value) : null;
      },
    },
  })
  accessor options: Record<string, unknown> | null = null;

  /**
   * Challenge method echoed back in the result event so the orchestrator
   * can include it in `challenge_response.method`. Defaults to `"passkey"`.
   */
  @property({ type: String }) accessor method = "passkey";

  /**
   * When true, the ceremony is not started automatically on mount.
   * The consumer must call `startCeremony()` manually.
   */
  @property({ type: Boolean }) accessor manual = false;

  /** Status line shown while the ceremony is in flight. Template-owned copy. */
  @property({ attribute: "pending-label" }) accessor pendingLabel = "Waiting for your passkey…";

  /** Label of the cancel button shown while the ceremony is in flight. */
  @property({ attribute: "cancel-label" }) accessor cancelLabel = "Cancel";

  /** Suppresses the built-in pending UI (headless / custom-template use). */
  @property({ type: Boolean }) accessor silent = false;

  /** True from ceremony start until it resolves, rejects, or is aborted. */
  @state() accessor pending = false;

  private abortController: AbortController | null = null;

  /** `Date.now()` at ceremony start, for timeout classification on reject. */
  private startedAt = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.manual && this.options) {
      void this.startCeremony();
    }
  }

  override disconnectedCallback(): void {
    this.abort();
    super.disconnectedCallback();
  }

  /**
   * Abort any in-flight WebAuthn ceremony. Called automatically when the
   * component disconnects (step change, page navigation) and by the
   * pending UI's cancel button. Clears `pending` immediately — the
   * ceremony's own `finally` no longer owns it (its controller is gone).
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.pending = false;
  }

  /**
   * Trigger the WebAuthn ceremony. Resolves when the ceremony completes
   * or rejects on error/abort.
   */
  async startCeremony(): Promise<void> {
    if (!this.options) {
      this.emitError("No WebAuthn options provided.", false);
      return;
    }

    if (!window.PublicKeyCredential) {
      this.emitError("WebAuthn is not supported in this browser.", false);
      return;
    }

    this.abort();
    const controller = new AbortController();
    this.abortController = controller;
    this.pending = true;
    this.startedAt = Date.now();
    this.emitStarted();

    try {
      const credential =
        this.ceremony === "register"
          ? await this.createCredential()
          : await this.getCredential();

      if (!credential) {
        this.emitError("No credential returned by the browser.", false);
        return;
      }

      const proof = this.serializeCredential(credential);
      this.emitResult(proof);
    } catch (error) {
      const aborted =
        error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "NotAllowedError");
      // Browsers report a ceremony timeout as `NotAllowedError`, identical
      // to a user dismissal. Only elapsed time tells them apart; a
      // programmatic `AbortError` is never a timeout.
      const timeoutMs = typeof this.options?.timeout === "number" ? this.options.timeout : null;
      const timedOut =
        error instanceof DOMException &&
        error.name === "NotAllowedError" &&
        timeoutMs !== null &&
        Date.now() - this.startedAt >= timeoutMs - TIMEOUT_GRACE_MS;

      this.emitError(
        error instanceof Error ? error.message : "WebAuthn ceremony failed.",
        aborted,
        timedOut,
      );
    } finally {
      // A restarted ceremony (manual `startCeremony()` while one is in
      // flight) aborts the old run; its late `finally` must not clear the
      // new run's pending state.
      if (this.abortController === controller) {
        this.pending = false;
      }
    }
  }

  private handleCancelSubmit = (event: Event): void => {
    // The cancel button's `zl-submit` must not reach the orchestrator's
    // shadow-root listener — it would be treated as a step submission.
    event.stopPropagation();
    this.abort();
  };

  override render() {
    if (!this.pending || this.silent) {
      return nothing;
    }
    return html`
      <div class="zl-passkey-pending" data-testid="zitadel-passkey-pending">
        <zl-alert severity="info">${this.pendingLabel}</zl-alert>
        <zl-button
          hierarchy="secondary"
          type="button"
          block
          data-testid="zitadel-passkey-cancel"
          label=${this.cancelLabel}
          @zl-submit=${this.handleCancelSubmit}
        ></zl-button>
      </div>
    `;
  }

  /**
   * `navigator.credentials.get()` — authentication ceremony.
   */
  private async getCredential(): Promise<PublicKeyCredential | null> {
    const opts = this.options;
    if (!opts) throw new Error("getCredential called without options");

    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: base64UrlToBuffer(opts.challenge as string),
      rpId: opts.rpId as string | undefined,
      timeout: opts.timeout as number | undefined,
      userVerification: opts.userVerification as UserVerificationRequirement | undefined,
      allowCredentials: this.decodeCredentialDescriptors(
        opts.allowCredentials as Array<Record<string, unknown>> | undefined,
      ),
    };

    const result = await navigator.credentials.get({
      publicKey: publicKeyOptions,
      signal: this.abortController?.signal,
    });

    return result as PublicKeyCredential | null;
  }

  /**
   * `navigator.credentials.create()` — registration ceremony.
   */
  private async createCredential(): Promise<PublicKeyCredential | null> {
    const opts = this.options;
    if (!opts) throw new Error("createCredential called without options");

    const rp = opts.rp as { id?: string; name: string };
    const user = opts.user as Record<string, unknown>;
    const pubKeyCredParams = opts.pubKeyCredParams as Array<{
      type: string;
      alg: number;
    }>;

    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      challenge: base64UrlToBuffer(opts.challenge as string),
      rp: { name: rp.name, ...(rp.id ? { id: rp.id } : {}) },
      user: {
        id: base64UrlToBuffer(user.id as string),
        name: user.name as string,
        displayName: user.displayName as string,
      },
      pubKeyCredParams: pubKeyCredParams.map((p) => ({
        type: p.type as PublicKeyCredentialType,
        alg: p.alg,
      })),
      timeout: opts.timeout as number | undefined,
      attestation: (opts.attestation as AttestationConveyancePreference) ?? "none",
      authenticatorSelection: opts.authenticatorSelection as
        | AuthenticatorSelectionCriteria
        | undefined,
      excludeCredentials: this.decodeCredentialDescriptors(
        opts.excludeCredentials as Array<Record<string, unknown>> | undefined,
      ),
    };

    const result = await navigator.credentials.create({
      publicKey: publicKeyOptions,
      signal: this.abortController?.signal,
    });

    return result as PublicKeyCredential | null;
  }

  /**
   * Decode a list of credential descriptors from the server's base64url
   * format to the browser's ArrayBuffer format.
   */
  private decodeCredentialDescriptors(
    descriptors: Array<Record<string, unknown>> | undefined,
  ): PublicKeyCredentialDescriptor[] {
    if (!descriptors) return [];
    return descriptors.map((d) => ({
      type: d.type as PublicKeyCredentialType,
      id: base64UrlToBuffer(d.id as string),
      transports: d.transports as AuthenticatorTransport[] | undefined,
    }));
  }

  /**
   * Serialize a `PublicKeyCredential` to the JSON shape defined in
   * `passkey-proof.yaml`. All `ArrayBuffer` fields are base64url-encoded.
   */
  private serializeCredential(
    credential: PublicKeyCredential,
  ): ZlPasskeyResultDetail["proof"] {
    const response = credential.response;

    const serialized: ZlPasskeyResultDetail["proof"] = {
      id: credential.id,
      rawId: bufferToBase64Url(credential.rawId),
      type: "public-key",
      response: {
        clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      },
    };

    // Attestation response (registration)
    if ("attestationObject" in response) {
      const attestation = response as AuthenticatorAttestationResponse;
      serialized.response.attestationObject = bufferToBase64Url(
        attestation.attestationObject,
      );
    }

    // Assertion response (authentication)
    if ("authenticatorData" in response) {
      const assertion = response as AuthenticatorAssertionResponse;
      serialized.response.authenticatorData = bufferToBase64Url(
        assertion.authenticatorData,
      );
      serialized.response.signature = bufferToBase64Url(assertion.signature);
      if (assertion.userHandle) {
        serialized.response.userHandle = bufferToBase64Url(assertion.userHandle);
      }
    }

    if (credential.authenticatorAttachment) {
      serialized.authenticatorAttachment = credential.authenticatorAttachment as
        | "platform"
        | "cross-platform";
    }

    return serialized;
  }

  private emitResult(proof: ZlPasskeyResultDetail["proof"]): void {
    const detail: ZlPasskeyResultDetail = {
      challenge_id: this.challengeId,
      method: this.method,
      proof,
    };
    this.dispatchEvent(
      new CustomEvent("zl-passkey-result", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private emitError(message: string, aborted: boolean, timedOut = false): void {
    const detail: ZlPasskeyErrorDetail = {
      challenge_id: this.challengeId,
      error: message,
      aborted,
      timed_out: timedOut,
    };
    this.dispatchEvent(
      new CustomEvent("zl-passkey-error", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private emitStarted(): void {
    const detail: ZlPasskeyStartedDetail = {
      challenge_id: this.challengeId,
      method: this.method,
    };
    this.dispatchEvent(
      new CustomEvent("zl-passkey-started", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  /**
   * Light DOM on purpose: the pending UI must land inside the
   * orchestrator's shadow root (where the step's adopted styles apply)
   * without altering the `unsafeHTML` step markup — runtime children don't
   * participate in its string comparison, so the ceremony never restarts.
   */
  override createRenderRoot(): this {
    return this;
  }
}

export const zlPasskeyManifest: AtomManifest = {
  tag: "zl-passkey",
  consumes: {},
  attrs: [
    "ceremony",
    "method",
    "challenge-id",
    "options",
    "manual",
    "pending-label",
    "cancel-label",
    "silent",
  ],
  parts: [],
  slots: [],
  events: ["zl-passkey-result", "zl-passkey-error", "zl-passkey-started"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-passkey": ZlPasskey;
  }
}
