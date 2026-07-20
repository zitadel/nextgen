import { LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { AtomManifest } from "../manifest.js";

/**
 * Detail shape emitted by the `zl-captcha-result` event.
 *
 * The orchestrator collects these and includes them in `gate_proofs`
 * on the next submit body, keyed by `gate_name`.
 *
 * `proof` is an opaque string, per `flow-submit-request.yaml`:
 * - Altcha: the base64-encoded JSON solution payload (the standard
 *   Altcha widget wire format).
 * - Third-party vendors: the token their widget callback returns.
 */
export type ZlCaptchaResultDetail = {
  gate_name: string;
  proof: string;
};

/**
 * Detail shape emitted by the `zl-captcha-error` event.
 *
 * The orchestrator surfaces this as a `step.error` so the user sees
 * a `<zl-alert>` banner.
 */
export type ZlCaptchaErrorDetail = {
  gate_name: string;
  error: string;
};

/** Third-party vendor script URLs, keyed by provider. */
const VENDOR_SCRIPTS: Record<string, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js",
  hcaptcha: "https://js.hcaptcha.com/1/api.js",
  recaptcha: "https://www.google.com/recaptcha/api.js",
};

/** Module-level dedup set — prevents loading the same vendor script twice. */
const loadedScripts = new Set<string>();

/**
 * Solve an Altcha proof-of-work challenge: brute-force `hash(salt + n)`
 * for `n` in `0..maxNumber` until the hex digest equals `challenge`.
 *
 * Exported for tests; not part of the public package API.
 */
export async function solveAltchaChallenge(
  algorithm: string,
  challenge: string,
  salt: string,
  maxNumber: number,
  signal?: AbortSignal,
): Promise<{ number: number; salt: string }> {
  const encoder = new TextEncoder();
  for (let n = 0; n <= maxNumber; n++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const data = encoder.encode(salt + n);
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    if (bufferToHex(hashBuffer) === challenge) {
      return { number: n, salt };
    }
  }
  throw new Error("Altcha: no solution found within max_number range.");
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Solve the Altcha PoW in a Web Worker when available (keeps the main
 * thread free for large `max_number` budgets), falling back to the
 * main-thread loop when Workers are unavailable or CSP blocks blob URLs.
 */
function solveAltchaWithWorkerFallback(
  algorithm: string,
  challenge: string,
  salt: string,
  maxNumber: number,
  signal?: AbortSignal,
): Promise<{ number: number; salt: string }> {
  if (typeof Worker !== "undefined") {
    try {
      return solveAltchaInWorker(algorithm, challenge, salt, maxNumber, signal);
    } catch {
      // Worker creation failed (CSP, etc.) — fall through to main thread.
    }
  }
  return solveAltchaChallenge(algorithm, challenge, salt, maxNumber, signal);
}

function solveAltchaInWorker(
  algorithm: string,
  challenge: string,
  salt: string,
  maxNumber: number,
  signal?: AbortSignal,
): Promise<{ number: number; salt: string }> {
  const workerCode = `
    self.onmessage = async function(e) {
      const { algorithm, challenge, salt, maxNumber } = e.data;
      const encoder = new TextEncoder();
      for (let n = 0; n <= maxNumber; n++) {
        const data = encoder.encode(salt + n);
        const hashBuffer = await crypto.subtle.digest(algorithm, data);
        const hashHex = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        if (hashHex === challenge) {
          self.postMessage({ number: n, salt });
          return;
        }
      }
      self.postMessage({ error: 'No solution found' });
    };
  `;

  const blob = new Blob([workerCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    };

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          cleanup();
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    }

    worker.onmessage = (e: MessageEvent) => {
      cleanup();
      if (e.data.error) {
        reject(new Error(`Altcha worker: ${e.data.error}`));
      } else {
        resolve(e.data as { number: number; salt: string });
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(`Altcha worker error: ${e.message}`));
    };

    worker.postMessage({ algorithm, challenge, salt, maxNumber });
  });
}

function loadVendorScript(provider: string): Promise<void> {
  const url = VENDOR_SCRIPTS[provider];
  if (!url) {
    return Promise.reject(new Error(`Unknown captcha provider: ${provider}`));
  }

  if (loadedScripts.has(provider)) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;

    script.onload = () => {
      loadedScripts.add(provider);
      resolve();
    };
    script.onerror = () => {
      reject(new Error(`Failed to load ${provider} script from ${url}`));
    };

    document.head.appendChild(script);
  });
}

/** Number of automatic solve attempts before emitting `zl-captcha-error`. */
const DEFAULT_MAX_RETRIES = 3;

/** How long to wait for a third-party widget token before giving up. */
const VENDOR_WIDGET_TIMEOUT_MS = 120_000;

/**
 * Atom: `<zl-captcha>` — invisible captcha gate solver.
 *
 * Mounted by the Liquid template, or injected by the `mandatory-gates`
 * patcher when a step carries a gate with no consumer in the template.
 * On mount it reads the gate configuration from attributes, dispatches on
 * `kind` + `provider` to pick a solver, and emits the proof.
 *
 * The orchestrator listens for `zl-captcha-result` to collect proofs into
 * `gate_proofs` on the next submit body.
 *
 * `captcha` is the only gate kind (ADR 013), with providers:
 * - `altcha` — built-in proof-of-work, no vendor script
 * - `turnstile` — Cloudflare Turnstile widget
 * - `hcaptcha` — hCaptcha widget
 * - `recaptcha` — Google reCAPTCHA widget
 *
 * Third-party widgets mount in light DOM: reCAPTCHA and hCaptcha break
 * inside shadow roots (cross-origin iframe + document lookup friction),
 * and light-DOM children don't participate in the orchestrator's
 * `unsafeHTML` string comparison, so an in-flight solve isn't restarted
 * by unrelated re-renders.
 *
 * A missing/null `config` is a silent no-op, not an error: the atom is
 * always safe to place in a template even when the current step carries
 * no gate data yet.
 *
 * Spec: ADR 019 — Captcha Gate Contract & Bot-Detection Signals
 */
@customElement("zl-captcha")
export class ZlCaptcha extends LitElement {
  /** Gate category. Currently only `captcha` (ADR 013). */
  @property() accessor kind = "captcha";

  /** Provider within the gate kind. */
  @property() accessor provider = "altcha";

  /** The key in `step.gates` — echoed in the result event so the
   * orchestrator can key `gate_proofs` correctly. */
  @property({ attribute: "gate-name" }) accessor gateName = "";

  /** Provider-specific public config (JSON string via attribute, object
   * via property). Invalid JSON parses to `null` — the atom then idles. */
  @property({
    attribute: "config",
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
  accessor config: Record<string, unknown> | null = null;

  /**
   * When true, the solve is not started automatically on mount.
   * The consumer must call `startSolve()` manually.
   */
  @property({ type: Boolean }) accessor manual = false;

  private abortController: AbortController | null = null;
  private retryCount = 0;
  private widgetContainer: HTMLDivElement | null = null;
  private autoSolveStarted = false;

  /**
   * Auto-solve from `updated()` rather than `connectedCallback`: initial
   * attributes are only reflected to properties by the first update, and
   * a config that arrives late (property set after mount) should start
   * the solve too. `autoSolveStarted` keeps this one-shot per element.
   */
  override updated(changed: PropertyValues): void {
    if (changed.has("config")) {
      this.maybeAutoSolve();
    }
  }

  private maybeAutoSolve(): void {
    if (!this.manual && this.config && !this.autoSolveStarted) {
      this.autoSolveStarted = true;
      void this.startSolve();
    }
  }

  override disconnectedCallback(): void {
    this.abort();
    this.cleanupWidget();
    super.disconnectedCallback();
  }

  /** Abort any in-flight solve. */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /** Trigger the gate solve. Dispatches on `kind` + `provider`. */
  async startSolve(): Promise<void> {
    if (!this.config) {
      // The auto-solve path never gets here (maybeAutoSolve guards on
      // config) — an explicit call without config is a consumer bug.
      this.emitError("No gate config provided.");
      return;
    }

    this.abort();
    this.abortController = new AbortController();
    this.retryCount = 0;

    await this.solveWithRetry();
  }

  private async solveWithRetry(): Promise<void> {
    while (this.retryCount < DEFAULT_MAX_RETRIES) {
      try {
        const proof = await this.solve();
        this.emitResult(proof);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return; // Component disconnected — don't retry or emit.
        }
        this.retryCount++;
        if (this.retryCount >= DEFAULT_MAX_RETRIES) {
          this.emitError(
            error instanceof Error ? error.message : "Captcha solve failed.",
          );
        }
      }
    }
  }

  private async solve(): Promise<string> {
    if (this.kind !== "captcha") {
      throw new Error(`Unsupported gate kind: ${this.kind}`);
    }

    switch (this.provider) {
      case "altcha":
        return this.solveAltcha();
      case "turnstile":
      case "hcaptcha":
      case "recaptcha":
        return this.solveVendor();
      default:
        throw new Error(`Unsupported captcha provider: ${this.provider}`);
    }
  }

  private async solveAltcha(): Promise<string> {
    const cfg = this.config;
    if (!cfg) throw new Error("Altcha config not provided.");
    const algorithm = (cfg.algorithm as string) ?? "SHA-256";
    const challenge = cfg.challenge as string;
    const salt = cfg.salt as string;
    const maxNumber = (cfg.max_number as number) ?? 100_000;

    if (!challenge || !salt) {
      throw new Error("Altcha config missing challenge or salt.");
    }

    const { number } = await solveAltchaWithWorkerFallback(
      algorithm,
      challenge,
      salt,
      maxNumber,
      this.abortController?.signal,
    );

    // The standard Altcha payload: base64-encoded JSON of the solution.
    // `signature` is passed through when the server minted one.
    return btoa(
      JSON.stringify({
        algorithm,
        challenge,
        number,
        salt,
        ...(typeof cfg.signature === "string" ? { signature: cfg.signature } : {}),
      }),
    );
  }

  private async solveVendor(): Promise<string> {
    await loadVendorScript(this.provider);
    return this.renderVendorWidget();
  }

  /**
   * Render a vendor captcha widget in light DOM and wait for the token
   * callback. Each vendor has a slightly different global API.
   */
  private renderVendorWidget(): Promise<string> {
    const siteKey = this.config?.site_key as string | undefined;
    if (!siteKey) {
      return Promise.reject(
        new Error(`${this.provider}: missing site_key in config.`),
      );
    }

    if (!this.widgetContainer) {
      this.widgetContainer = document.createElement("div");
      this.appendChild(this.widgetContainer);
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${this.provider}: widget timed out.`));
      }, VENDOR_WIDGET_TIMEOUT_MS);

      const callback = (token: string) => {
        clearTimeout(timeout);
        resolve(token);
      };

      const errorCallback = () => {
        clearTimeout(timeout);
        reject(new Error(`${this.provider}: widget error.`));
      };

      try {
        this.mountVendorWidget(siteKey, callback, errorCallback);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  /** Mount the vendor widget through its global render API. */
  private mountVendorWidget(
    siteKey: string,
    callback: (token: string) => void,
    errorCallback: () => void,
  ): void {
    const container = this.widgetContainer;
    if (!container) throw new Error("Widget container not initialized.");

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const win = window as any;

    switch (this.provider) {
      case "turnstile":
        if (!win.turnstile) throw new Error("Turnstile API not loaded.");
        win.turnstile.render(container, {
          sitekey: siteKey,
          callback,
          "error-callback": errorCallback,
        });
        break;

      case "hcaptcha":
        if (!win.hcaptcha) throw new Error("hCaptcha API not loaded.");
        win.hcaptcha.render(container, {
          sitekey: siteKey,
          callback,
          "error-callback": errorCallback,
        });
        break;

      case "recaptcha":
        if (!win.grecaptcha) throw new Error("reCAPTCHA API not loaded.");
        win.grecaptcha.ready(() => {
          win.grecaptcha.render(container, {
            sitekey: siteKey,
            callback,
            "error-callback": errorCallback,
          });
        });
        break;

      default:
        throw new Error(`No widget renderer for provider: ${this.provider}`);
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  private cleanupWidget(): void {
    if (this.widgetContainer) {
      this.widgetContainer.remove();
      this.widgetContainer = null;
    }
  }

  private emitResult(proof: string): void {
    const detail: ZlCaptchaResultDetail = {
      gate_name: this.gateName,
      proof,
    };
    this.dispatchEvent(
      new CustomEvent("zl-captcha-result", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private emitError(message: string): void {
    const detail: ZlCaptchaErrorDetail = {
      gate_name: this.gateName,
      error: message,
    };
    this.dispatchEvent(
      new CustomEvent("zl-captcha-error", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  /**
   * Light DOM on purpose: vendor widgets can't live in a shadow root, and
   * runtime children don't participate in the orchestrator's `unsafeHTML`
   * string comparison, so an in-flight solve survives unrelated re-renders.
   */
  override createRenderRoot(): this {
    return this;
  }
}

export const zlCaptchaManifest: AtomManifest = {
  tag: "zl-captcha",
  consumes: {},
  satisfies_gate: "captcha",
  attrs: ["kind", "provider", "gate-name", "config", "manual"],
  parts: [],
  slots: [],
  events: ["zl-captcha-result", "zl-captcha-error"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-captcha": ZlCaptcha;
  }
}
