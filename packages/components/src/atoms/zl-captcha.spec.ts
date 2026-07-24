import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZlCaptcha, solveAltchaChallenge, zlCaptchaManifest } from "./zl-captcha.js";

// `crypto.subtle` comes from `vitest.setup.unit.ts` (jsdom 29 lacks it).

/** Mint an Altcha challenge the way the server would: hex(SHA-256(salt + n)). */
async function mintChallenge(solution: number, salt: string): Promise<string> {
  const data = new TextEncoder().encode(salt + solution);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("zlCaptchaManifest", () => {
  it("declares the correct tag", () => {
    expect(zlCaptchaManifest.tag).toBe("zl-captcha");
  });

  it("satisfies the captcha gate kind", () => {
    expect(zlCaptchaManifest.satisfies_gate).toBe("captcha");
  });

  it("declares expected attributes", () => {
    expect(zlCaptchaManifest.attrs).toContain("kind");
    expect(zlCaptchaManifest.attrs).toContain("provider");
    expect(zlCaptchaManifest.attrs).toContain("gate-name");
    expect(zlCaptchaManifest.attrs).toContain("config");
    expect(zlCaptchaManifest.attrs).toContain("manual");
  });

  it("declares result and error events", () => {
    expect(zlCaptchaManifest.events).toContain("zl-captcha-result");
    expect(zlCaptchaManifest.events).toContain("zl-captcha-error");
  });

  it("has no parts or slots (invisible component)", () => {
    expect(zlCaptchaManifest.parts).toEqual([]);
    expect(zlCaptchaManifest.slots).toEqual([]);
  });
});

describe("solveAltchaChallenge", () => {
  it("finds the solution number for a minted challenge", async () => {
    const salt = "abc123";
    const challenge = await mintChallenge(7, salt);
    const result = await solveAltchaChallenge("SHA-256", challenge, salt, 50);
    expect(result).toEqual({ number: 7, salt });
  });

  it("throws when no solution exists within max_number", async () => {
    const salt = "abc123";
    const challenge = await mintChallenge(30, salt);
    await expect(solveAltchaChallenge("SHA-256", challenge, salt, 10)).rejects.toThrow(
      /no solution found/,
    );
  });

  it("rejects with AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      solveAltchaChallenge("SHA-256", "deadbeef", "salt", 10, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("<zl-captcha>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("is a registered custom element", () => {
    const ctor = customElements.get("zl-captcha");
    expect(ctor).toBe(ZlCaptcha);
  });

  it("defaults kind to captcha and provider to altcha", () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    expect(el.kind).toBe("captcha");
    expect(el.provider).toBe("altcha");
  });

  it("parses config from a JSON attribute", () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.setAttribute("config", '{"challenge":"abc","salt":"xyz"}');
    expect(el.config).toEqual({ challenge: "abc", salt: "xyz" });
  });

  it("returns null for invalid JSON config", () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.setAttribute("config", "not-json");
    expect(el.config).toBeNull();
  });

  it("renders in light DOM (no shadow root)", () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    host.appendChild(el);
    expect(el.shadowRoot).toBeNull();
  });

  it("solves an altcha challenge on mount and emits the base64 proof", async () => {
    const salt = "mount-salt";
    const challenge = await mintChallenge(5, salt);

    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.setAttribute("gate-name", "bot_check");
    el.setAttribute(
      "config",
      JSON.stringify({ algorithm: "SHA-256", challenge, salt, max_number: 20 }),
    );

    const resultPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-captcha-result", (e) => resolve(e as CustomEvent), {
        once: true,
      });
    });

    host.appendChild(el);
    const event = await resultPromise;

    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.detail.gate_name).toBe("bot_check");
    expect(typeof event.detail.proof).toBe("string");
    expect(JSON.parse(atob(event.detail.proof))).toEqual({
      algorithm: "SHA-256",
      challenge,
      number: 5,
      salt,
    });
  });

  it("starts solving when config arrives after mount", async () => {
    const salt = "late-salt";
    const challenge = await mintChallenge(3, salt);

    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.setAttribute("gate-name", "bot_check");
    host.appendChild(el);

    const resultPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-captcha-result", (e) => resolve(e as CustomEvent), {
        once: true,
      });
    });

    // Null-safe idle until data shows up, then the solve starts.
    el.config = { algorithm: "SHA-256", challenge, salt, max_number: 20 };

    const event = await resultPromise;
    expect(JSON.parse(atob(event.detail.proof)).number).toBe(3);
  });

  it("does not auto-start when manual is set", async () => {
    const salt = "manual-salt";
    const challenge = await mintChallenge(2, salt);

    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.manual = true;
    el.setAttribute(
      "config",
      JSON.stringify({ algorithm: "SHA-256", challenge, salt, max_number: 20 }),
    );

    let emitted = false;
    el.addEventListener("zl-captcha-result", () => {
      emitted = true;
    });

    host.appendChild(el);
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(emitted).toBe(false);
  });

  it("stays idle without config on mount, but errors on an explicit startSolve", async () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.gateName = "test_gate";

    const errors: string[] = [];
    el.addEventListener("zl-captcha-error", (e) => {
      errors.push((e as CustomEvent).detail.error as string);
    });

    // Auto path: mounting without config is a silent no-op.
    host.appendChild(el);
    await el.updateComplete;
    expect(errors).toEqual([]);

    // Explicit call without config is a consumer bug and fails loudly.
    await el.startSolve();
    expect(errors).toEqual(["No gate config provided."]);
  });

  it("emits zl-captcha-error with detail shape for an unsupported kind", async () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.kind = "unknown";
    el.gateName = "test_gate";
    el.config = { challenge: "abc" };
    el.manual = true;

    const errorPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-captcha-error", (e) => resolve(e as CustomEvent), {
        once: true,
      });
    });

    host.appendChild(el);
    void el.startSolve();

    const event = await errorPromise;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.detail.gate_name).toBe("test_gate");
    expect(event.detail.error).toContain("Unsupported gate kind");
  });

  it("emits zl-captcha-error with detail shape for an unsupported provider", async () => {
    const el = document.createElement("zl-captcha") as ZlCaptcha;
    el.kind = "captcha";
    el.provider = "unknown_provider";
    el.gateName = "test_gate";
    el.config = { challenge: "abc" };
    el.manual = true;

    const errorPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-captcha-error", (e) => resolve(e as CustomEvent), {
        once: true,
      });
    });

    host.appendChild(el);
    void el.startSolve();

    const event = await errorPromise;
    expect(event.detail.gate_name).toBe("test_gate");
    expect(event.detail.error).toContain("Unsupported captcha provider");
  });
});
