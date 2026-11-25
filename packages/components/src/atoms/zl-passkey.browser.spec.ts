import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";

import "./zl-passkey.js";
import type { ZlPasskey } from "./zl-passkey.js";

/**
 * Real-browser checks for `<zl-passkey>`: the ceremony runs against Chromium's
 * own `navigator.credentials` and a virtual authenticator from the DevTools
 * protocol, so the proof is built from what a browser actually returns. The
 * jsdom spec pins the atom's logic against a stub; this one pins that its
 * serialisation matches the real thing. Run via `pnpm test:browser`.
 */
describe("<zl-passkey> virtual authenticator (chromium)", () => {
  let host: HTMLDivElement;
  let authenticatorId: string;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    await cdp().send("WebAuthn.enable");
    ({ authenticatorId } = await cdp().send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    }));
  });

  afterEach(async () => {
    host.remove();
    await cdp().send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp().send("WebAuthn.disable");
  });

  function create(props: Partial<ZlPasskey> = {}): ZlPasskey {
    const el = document.createElement("zl-passkey") as ZlPasskey;
    el.challengeId = "chal-1";
    el.method = "passkey";
    Object.assign(el, props);
    return el;
  }

  function nextEvent<T>(el: ZlPasskey, name: string): Promise<T> {
    return new Promise<T>((resolve) => {
      el.addEventListener(name, (event) => resolve((event as CustomEvent).detail as T), {
        once: true,
      });
    });
  }

  it("registers a passkey and serialises the attestation into base64url proof", async () => {
    const el = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required" },
      },
    });
    const detail = nextEvent<{
      proof: { id: string; rawId: string; response: { attestationObject?: string } };
    }>(el, "zl-passkey-result");
    host.appendChild(el);
    const result = await detail;

    const stored = await cdp().send("WebAuthn.getCredentials", { authenticatorId });
    expect(stored.credentials).toHaveLength(1);
    expect(result.proof.rawId).toBeTypeOf("string");
    expect(result.proof.rawId).not.toContain("=");
    expect(result.proof.id).toBe(result.proof.rawId);
    expect(result.proof.response.attestationObject).toBeTypeOf("string");
    expect(result.proof.response.attestationObject).not.toContain("=");
  });

  it("signs in with the registered discoverable credential", async () => {
    const registerEl = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required" },
      },
    });
    const registration = nextEvent<{ proof: { id: string } }>(registerEl, "zl-passkey-result");
    host.appendChild(registerEl);
    const registered = await registration;
    const el = create({ ceremony: "authenticate", options: { challenge: "AAAA" } });
    const detail = nextEvent<{
      proof: {
        id: string;
        authenticatorAttachment?: string;
        response: { authenticatorData?: string; signature?: string; userHandle?: string };
      };
    }>(el, "zl-passkey-result");
    host.appendChild(el);
    const result = await detail;

    expect(result.proof.id).toBe(registered.proof.id);
    expect(result.proof.authenticatorAttachment).toBe("platform");
    expect(result.proof.response.authenticatorData).toBeTypeOf("string");
    expect(result.proof.response.signature).toBeTypeOf("string");
    expect(result.proof.response.userHandle).toBe("dXNlci0x");
  });

  it("signs in with the non-discoverable credential named in allowCredentials", async () => {
    const registerEl = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "discouraged" },
      },
    });
    const registration = nextEvent<{ proof: { id: string; rawId: string } }>(
      registerEl,
      "zl-passkey-result",
    );
    host.appendChild(registerEl);
    const registered = await registration;
    const el = create({
      ceremony: "authenticate",
      options: {
        challenge: "AAAA",
        allowCredentials: [{ type: "public-key", id: registered.proof.rawId }],
      },
    });
    const detail = nextEvent<{ proof: { id: string } }>(el, "zl-passkey-result");
    host.appendChild(el);
    const result = await detail;

    expect(result.proof.id).toBe(registered.proof.id);
  });

  it("reports a failed user verification as an aborted ceremony", async () => {
    await cdp().send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    const el = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
      },
    });
    const errored = nextEvent<{ aborted: boolean; timed_out: boolean }>(el, "zl-passkey-error");
    host.appendChild(el);
    const result = await errored;

    const stored = await cdp().send("WebAuthn.getCredentials", { authenticatorId });
    expect(result.aborted).toBe(true);
    expect(result.timed_out).toBe(false);
    expect(stored.credentials).toHaveLength(0);
  });

  it("reports an authenticator without the credential as an aborted ceremony", async () => {
    const el = create({ ceremony: "authenticate", options: { challenge: "AAAA" } });
    const errored = nextEvent<{ aborted: boolean; timed_out: boolean }>(el, "zl-passkey-error");
    host.appendChild(el);
    const result = await errored;

    expect(result.aborted).toBe(true);
    expect(result.timed_out).toBe(false);
  });

  it("cancel click aborts a ceremony that is waiting on the authenticator", async () => {
    const registerEl = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required" },
      },
    });
    const registration = nextEvent(registerEl, "zl-passkey-result");
    host.appendChild(registerEl);
    await registration;
    await cdp().send("WebAuthn.setAutomaticPresenceSimulation", {
      authenticatorId,
      enabled: false,
    });
    const el = create({ ceremony: "authenticate", options: { challenge: "AAAA" } });
    const errored = nextEvent<{ aborted: boolean; timed_out: boolean }>(el, "zl-passkey-error");
    host.appendChild(el);
    await el.updateComplete;

    const cancel = el.querySelector<HTMLElement>('[data-testid="zitadel-passkey-cancel"]');
    expect(cancel).not.toBeNull();
    cancel?.click();

    const result = await errored;
    expect(result.aborted).toBe(true);
    expect(result.timed_out).toBe(false);
  });

  it("signs in with a u2f security key over usb", async () => {
    await cdp().send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    ({ authenticatorId } = await cdp().send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "u2f",
        transport: "usb",
        automaticPresenceSimulation: true,
      },
    }));
    const registerEl = create({
      ceremony: "register",
      method: "passkey_register",
      options: {
        challenge: "AAAA",
        rp: { name: "example.com" },
        user: { id: "dXNlci0x", name: "alice@example.com", displayName: "Alice" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "discouraged" },
      },
    });
    const registration = nextEvent<{ proof: { id: string; rawId: string } }>(
      registerEl,
      "zl-passkey-result",
    );
    host.appendChild(registerEl);
    const registered = await registration;
    const el = create({
      ceremony: "authenticate",
      options: {
        challenge: "AAAA",
        allowCredentials: [{ type: "public-key", id: registered.proof.rawId }],
      },
    });
    const detail = nextEvent<{
      proof: {
        id: string;
        authenticatorAttachment?: string;
        response: { signature?: string; userHandle?: string };
      };
    }>(el, "zl-passkey-result");
    host.appendChild(el);
    const result = await detail;

    expect(result.proof.id).toBe(registered.proof.id);
    expect(result.proof.authenticatorAttachment).toBe("cross-platform");
    expect(result.proof.response.signature).toBeTypeOf("string");
    expect(result.proof.response.userHandle).toBeUndefined();
  });
});
