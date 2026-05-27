import { LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";

import type { AtomManifest } from "../manifest.js";

// ---------------------------------------------------------------------------
// Third-party vendor script URLs
// ---------------------------------------------------------------------------
const VENDOR_SCRIPTS: Record<string, string> = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js",
  hcaptcha: "https://js.hcaptcha.com/1/api.js",
  recaptcha: "https://www.google.com/recaptcha/api.js",
};

/** Module-level dedup set — prevents loading the same vendor script twice. */
const loadedScripts = new Set<string>();

// ---------------------------------------------------------------------------
// Event detail types
// ---------------------------------------------------------------------------

/**
 * Detail shape emitted by the `zl-gate-result` event.
 *
 * The orchestrator collects these and includes them in `gate_proofs`
 * on the next submit body.
 */
export type ZlGateResultDetail = {
  gate_name: string;
  proof: Record<string, unknown>;
};

/**
 * Detail shape emitted by the `zl-gate-error` event.
 *
 * The orchestrator surfaces this as a `step.error` so the user sees
 * a `<zl-alert>` banner.
 */
export type ZlGateErrorDetail = {
  gate_name: string;
  error: string;
};

// ---------------------------------------------------------------------------
// Altcha PoW helpers
// ---------------------------------------------------------------------------

/**
 * Solve an Altcha proof-of-work challenge.
 *
 * Brute-forces `SHA-256(salt + n)` for `n` in `0..maxNumber` until the
 * resulting hex digest matches `challenge`.
 *
 * Runs on the main thread by default. When a Web Worker is available and
 * CSP allows `worker-src blob:`, the caller can offload this to a Worker
 * via `solveAltchaInWorker()`.
 */
async function solveAltcha(
  algorithm: string,
  challenge: string,
  salt: string,
  maxNumber: number,
): Promise<{ number: number; salt: string }> {
  const encoder = new TextEncoder();
  for (let n = 0; n <= maxNumber; n++) {
    const data = encoder.encode(salt + n);
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    const hashHex = bufferToHex(hashBuffer);
    if (hashHex === challenge) {
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
 * Attempt to solve the Altcha PoW in a Web Worker (progressive enhancement).
 * Falls back to main-thread `solveAltcha()` if Workers are unavailable or
 * CSP blocks blob URLs.
 */
function solveAltchaWithWorkerFallback(
  algorithm: string,
  challenge: string,
  salt: string,
  maxNumber: number,
  signal?: AbortSignal,
): Promise<{ number: number; salt: string }> {
  // Try Worker first
  if (typeof Worker !== "undefined") {
    try {
      return solveAltchaInWorker(algorithm, challenge, salt, maxNumber, signal);
    } catch {
      // Worker creation failed (CSP, etc.) — fall through to main-thread
    }
  }
  return solveAltcha(algorithm, challenge, salt, maxNumber);
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
      signal.addEventListener("abort", () => {
        cleanup();
        reject(new DOMException("Aborted", "AbortError"));
      });
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

// ---------------------------------------------------------------------------
// Vendor script loader
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// <zl-gate> component
// ---------------------------------------------------------------------------

/** Default number of automatic retries before emitting `zl-gate-error`. */
const DEFAULT_MAX_RETRIES = 3;

/**
 * Atom: `<zl-gate>` — invisible gate proof handler.
 *
 * This component is intentionally invisible. It is mounted by the Liquid
 * template (or injected by the `required-atoms` patcher) when a step
 * carries a gate. On mount, it reads the gate configuration from attributes,
 * dispatches on `kind` + `provider` to pick a solver strategy, and emits
 * the proof.
 *
 * The orchestrator listens for `zl-gate-result` to collect proofs into
 * `gate_proofs` on the next submit body.
 *
 * Currently the only gate `kind` is `captcha`, with providers:
 * - `altcha` — built-in proof-of-work (no vendor script)
 * - `turnstile` — Cloudflare Turnstile widget
 * - `hcaptcha` — hCaptcha widget
 * - `recaptcha` — Google reCAPTCHA widget
 *
 * Spec: ADR 016 — Captcha Gate Contract & Bot-Detection Signals
 */
@customElement("zl-gate")
export class ZlGate extends LitElement {
  /** Gate category. Currently only `captcha` (ADR 013). */
  @property() accessor kind = "captcha";

  /** Provider within the gate kind. */
  @property() accessor provider = "altcha";

  /** The key in `step.gates` — echoed in the result event so the
   * orchestrator can key `gate_proofs` correctly. */
  @property({ attribute: "gate-name" }) accessor gateName = "";

  /** Provider-specific public config (JSON). */
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

  /**
   * Auto-solve on first render. `firstUpdated` fires after Lit has reflected
   * all initial attributes to properties, so `this.config` is populated.
   * `connectedCallback` fires too early — attributes haven't been reflected yet.
   */
  override firstUpdated(): void {
    if (!this.manual && this.config) {
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

  /**
   * Trigger the gate solve. Dispatches on `kind` + `provider`.
   */
  async startSolve(): Promise<void> {
    if (!this.config) {
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
          return; // Component disconnected — don't retry or emit
        }
        this.retryCount++;
        if (this.retryCount >= DEFAULT_MAX_RETRIES) {
          this.emitError(
            error instanceof Error ? error.message : "Gate solve failed.",
          );
        }
      }
    }
  }

  private async solve(): Promise<Record<string, unknown>> {
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

  private async solveAltcha(): Promise<Record<string, unknown>> {
    const cfg = this.config;
    if (!cfg) throw new Error("Altcha config not provided.");
    const algorithm = (cfg.algorithm as string) ?? "SHA-256";
    const challenge = cfg.challenge as string;
    const salt = cfg.salt as string;
    const maxNumber = (cfg.max_number as number) ?? 100_000;

    if (!challenge || !salt) {
      throw new Error("Altcha config missing challenge or salt.");
    }

    const result = await solveAltchaWithWorkerFallback(
      algorithm,
      challenge,
      salt,
      maxNumber,
      this.abortController?.signal,
    );

    return { number: result.number, salt: result.salt };
  }

  private async solveVendor(): Promise<Record<string, unknown>> {
    await loadVendorScript(this.provider);
    const token = await this.renderVendorWidget();
    return { token };
  }

  /**
   * Render a vendor captcha widget in light DOM and wait for the token
   * callback. Each vendor has a slightly different global API.
   */
  private renderVendorWidget(): Promise<string> {
    const siteKey = this.config?.site_key as string | undefined;
    if (!siteKey) {
      return Promise.reject(new Error(`${this.provider}: missing site_key in config.`));
    }

    // Create or reuse the widget container
    if (!this.widgetContainer) {
      this.widgetContainer = document.createElement("div");
      this.appendChild(this.widgetContainer);
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`${this.provider}: widget timed out.`));
      }, 120_000); // 2 minute timeout

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

  /**
   * Mount the appropriate vendor widget. Each vendor exposes a slightly
   * different global render API.
   */
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

  private emitResult(proof: Record<string, unknown>): void {
    const detail: ZlGateResultDetail = {
      gate_name: this.gateName,
      proof,
    };
    this.dispatchEvent(
      new CustomEvent("zl-gate-result", {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }

  private emitError(message: string): void {
    const detail: ZlGateErrorDetail = {
      gate_name: this.gateName,
      error: message,
    };
    this.dispatchEvent(
      new CustomEvent("zl-gate-error", {
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

export const zlGateManifest: AtomManifest = {
  tag: "zl-gate",
  consumes: {},
  satisfies_gate: "captcha",
  attrs: ["kind", "provider", "gate-name", "config", "manual"],
  parts: [],
  slots: [],
  events: ["zl-gate-result", "zl-gate-error"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-gate": ZlGate;
  }
}
