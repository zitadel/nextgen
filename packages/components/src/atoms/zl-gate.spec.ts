import { describe, expect, it } from "vitest";

import { ZlGate, zlGateManifest } from "./zl-gate.js";

describe("zlGateManifest", () => {
  it("declares the correct tag", () => {
    expect(zlGateManifest.tag).toBe("zl-gate");
  });

  it("satisfies the captcha gate kind", () => {
    expect(zlGateManifest.satisfies_gate).toBe("captcha");
  });

  it("declares expected attributes", () => {
    expect(zlGateManifest.attrs).toContain("kind");
    expect(zlGateManifest.attrs).toContain("provider");
    expect(zlGateManifest.attrs).toContain("gate-name");
    expect(zlGateManifest.attrs).toContain("config");
    expect(zlGateManifest.attrs).toContain("manual");
  });

  it("declares result and error events", () => {
    expect(zlGateManifest.events).toContain("zl-gate-result");
    expect(zlGateManifest.events).toContain("zl-gate-error");
  });

  it("has no parts or slots (invisible component)", () => {
    expect(zlGateManifest.parts).toEqual([]);
    expect(zlGateManifest.slots).toEqual([]);
  });
});

describe("ZlGate", () => {
  it("is a registered custom element", () => {
    const ctor = customElements.get("zl-gate");
    expect(ctor).toBe(ZlGate);
  });

  it("defaults kind to captcha", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    expect(el.kind).toBe("captcha");
  });

  it("defaults provider to altcha", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    expect(el.provider).toBe("altcha");
  });

  it("parses config from a JSON attribute", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    el.setAttribute("config", '{"challenge":"abc","salt":"xyz"}');
    expect(el.config).toEqual({ challenge: "abc", salt: "xyz" });
  });

  it("returns null for invalid JSON config", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    el.setAttribute("config", "not-json");
    expect(el.config).toBeNull();
  });

  it("renders in light DOM (no shadow root)", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    document.body.appendChild(el);
    expect(el.shadowRoot).toBeNull();
    el.remove();
  });

  it("does not auto-start when manual is set", () => {
    const el = document.createElement("zl-gate") as ZlGate;
    el.manual = true;
    el.setAttribute("config", '{"challenge":"abc","salt":"xyz"}');
    // Should not throw or start solving
    document.body.appendChild(el);
    el.remove();
  });

  it("emits zl-gate-error with correct detail shape for unsupported kind", async () => {
    const el = document.createElement("zl-gate") as ZlGate;
    el.kind = "unknown";
    el.gateName = "test_gate";
    el.config = { challenge: "abc" };
    el.manual = true;

    const errorPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-gate-error", (e) => resolve(e as CustomEvent), { once: true });
    });

    document.body.appendChild(el);
    void el.startSolve();

    const event = await errorPromise;
    expect(event.bubbles).toBe(true);
    expect(event.composed).toBe(true);
    expect(event.detail.gate_name).toBe("test_gate");
    expect(event.detail.error).toContain("Unsupported gate kind");

    el.remove();
  });

  it("emits zl-gate-error with correct detail shape for unsupported provider", async () => {
    const el = document.createElement("zl-gate") as ZlGate;
    el.kind = "captcha";
    el.provider = "unknown_provider";
    el.gateName = "test_gate";
    el.config = { challenge: "abc" };
    el.manual = true;

    const errorPromise = new Promise<CustomEvent>((resolve) => {
      el.addEventListener("zl-gate-error", (e) => resolve(e as CustomEvent), { once: true });
    });

    document.body.appendChild(el);
    void el.startSolve();

    const event = await errorPromise;
    expect(event.detail.gate_name).toBe("test_gate");
    expect(event.detail.error).toContain("Unsupported captcha provider");

    el.remove();
  });
});
