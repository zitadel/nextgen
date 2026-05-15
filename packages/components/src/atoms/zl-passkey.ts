import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import { bufferToBase64Url, base64UrlToBuffer } from "../internal/base64url.js";
import type { AtomManifest } from "../manifest.js";

/**
 * Detail shape emitted by the `zl-passkey-result` event.
 *
 * Mirrors the `passkey-proof.yaml` schema (serialized PublicKeyCredential)
 * plus the `challenge_id` the orchestrator needs for the submit body.
 */
export type ZlPasskeyResultDetail = {
  challenge_id: string;
  method: "passkey";
  passkey: {
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
 */
export type ZlPasskeyErrorDetail = {
  challenge_id: string;
  error: string;
  aborted: boolean;
};

/**
 * Atom: `<zl-passkey>` — invisible WebAuthn ceremony handler.
 *
 * This component is intentionally invisible. It is mounted by the Liquid
 * template when `step.challenge.type === "passkey"`. On mount, it reads
 * the challenge options from attributes, triggers the appropriate
 * `navigator.credentials` ceremony, and emits the result.
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
   * When true, the ceremony is not started automatically on mount.
   * The consumer must call `startCeremony()` manually.
   */
  @property({ type: Boolean }) accessor manual = false;

  private abortController: AbortController | null = null;

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
   * component disconnects (step change, page navigation).
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
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
    this.abortController = new AbortController();

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

      this.emitError(
        error instanceof Error ? error.message : "WebAuthn ceremony failed.",
        aborted,
      );
    }
  }

  /**
   * `navigator.credentials.get()` — authentication ceremony.
   */
  private async getCredential(): Promise<PublicKeyCredential | null> {
    const opts = this.options!;

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
      signal: this.abortController!.signal,
    });

    return result as PublicKeyCredential | null;
  }

  /**
   * `navigator.credentials.create()` — registration ceremony.
   */
  private async createCredential(): Promise<PublicKeyCredential | null> {
    const opts = this.options!;

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
      signal: this.abortController!.signal,
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
  ): ZlPasskeyResultDetail["passkey"] {
    const response = credential.response;

    const serialized: ZlPasskeyResultDetail["passkey"] = {
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

  private emitResult(passkey: ZlPasskeyResultDetail["passkey"]): void {
    const detail: ZlPasskeyResultDetail = {
      challenge_id: this.challengeId,
      method: "passkey",
      passkey,
    };
    this.dispatchEvent(
      new CustomEvent("zl-passkey-result", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private emitError(message: string, aborted: boolean): void {
    const detail: ZlPasskeyErrorDetail = {
      challenge_id: this.challengeId,
      error: message,
      aborted,
    };
    this.dispatchEvent(
      new CustomEvent("zl-passkey-error", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  /** Invisible component — no shadow DOM rendering needed. */
  override createRenderRoot(): this {
    return this;
  }
}

export const zlPasskeyManifest: AtomManifest = {
  tag: "zl-passkey",
  consumes: {},
  attrs: ["ceremony", "challenge-id", "options", "manual"],
  parts: [],
  slots: [],
  events: ["zl-passkey-result", "zl-passkey-error"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-passkey": ZlPasskey;
  }
}
