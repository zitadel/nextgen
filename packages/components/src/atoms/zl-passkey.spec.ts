import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zl-passkey.js";
import type { ZlPasskey } from "./zl-passkey.js";

/**
 * Behaviour contract for `<zl-passkey>`, driven through its public events and
 * a mocked `navigator.credentials`. This is the safety net for the Phase 6
 * extraction of the ceremony into a ReactiveController: error paths,
 * auto-start vs manual timing, abort-on-disconnect, and the credential
 * serialisation (`serializeCredential` / `decodeCredentialDescriptors`) all
 * stay observable here.
 */
type CredentialsStub = { get: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function fakeAssertion(): PublicKeyCredential {
  return {
    id: "cred-id",
    rawId: bytes("rawid"),
    type: "public-key",
    authenticatorAttachment: "platform",
    response: {
      clientDataJSON: bytes("{}"),
      authenticatorData: bytes("authdata"),
      signature: bytes("sig"),
    },
  } as unknown as PublicKeyCredential;
}

describe("<zl-passkey>", () => {
  let host: HTMLDivElement;
  let credentials: CredentialsStub;
  let originalCredentials: PropertyDescriptor | undefined;
  let originalPublicKeyCredential: PropertyDescriptor | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);

    credentials = {
      get: vi.fn(async () => fakeAssertion()),
      create: vi.fn(async () => fakeAssertion()),
    };
    originalCredentials = Object.getOwnPropertyDescriptor(navigator, "credentials");
    Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });

    originalPublicKeyCredential = Object.getOwnPropertyDescriptor(window, "PublicKeyCredential");
    // A truthy stand-in so `window.PublicKeyCredential` passes the support
    // guard; the ceremony itself runs against the mocked `navigator.credentials`.
    Object.defineProperty(window, "PublicKeyCredential", {
      value: class PublicKeyCredentialStub {},
      configurable: true,
    });
  });

  afterEach(() => {
    host.remove();
    if (originalCredentials) {
      Object.defineProperty(navigator, "credentials", originalCredentials);
    } else {
      delete (navigator as unknown as Record<string, unknown>).credentials;
    }
    if (originalPublicKeyCredential) {
      Object.defineProperty(window, "PublicKeyCredential", originalPublicKeyCredential);
    } else {
      delete (window as unknown as Record<string, unknown>).PublicKeyCredential;
    }
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
      el.addEventListener(name, (event) => resolve((event as CustomEvent).detail as T), { once: true });
    });
  }

  it("errors (not aborted) when started without options", async () => {
    const el = create({ manual: true });
    host.appendChild(el);
    const detail = nextEvent<{ error: string; aborted: boolean; challenge_id: string }>(
      el,
      "zl-passkey-error",
    );
    void el.startCeremony();
    const result = await detail;
    expect(result.aborted).toBe(false);
    expect(result.error).toMatch(/options/i);
    expect(result.challenge_id).toBe("chal-1");
  });

  it("errors when WebAuthn is unsupported", async () => {
    delete (window as unknown as Record<string, unknown>).PublicKeyCredential;
    const el = create({ manual: true, options: { challenge: "AAAA" } });
    host.appendChild(el);
    const detail = nextEvent<{ error: string; aborted: boolean }>(el, "zl-passkey-error");
    void el.startCeremony();
    const result = await detail;
    expect(result.aborted).toBe(false);
    expect(result.error).toMatch(/not supported/i);
  });

  it("does not auto-start the ceremony in manual mode", async () => {
    const el = create({ manual: true, options: { challenge: "AAAA" } });
    host.appendChild(el);
    await Promise.resolve();
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it("auto-starts on connect and serialises the assertion into base64url proof", async () => {
    const el = create({
      ceremony: "authenticate",
      options: {
        challenge: "AAAA",
        allowCredentials: [{ type: "public-key", id: "AAAA", transports: ["internal"] }],
      },
    });
    const detail = nextEvent<{
      challenge_id: string;
      method: string;
      proof: {
        id: string;
        rawId: string;
        type: string;
        authenticatorAttachment?: string;
        response: { clientDataJSON: string; authenticatorData?: string; signature?: string };
      };
    }>(el, "zl-passkey-result");
    host.appendChild(el);
    const result = await detail;

    expect(credentials.get).toHaveBeenCalledTimes(1);
    expect(result.challenge_id).toBe("chal-1");
    expect(result.method).toBe("passkey");
    expect(result.proof.type).toBe("public-key");
    expect(result.proof.id).toBe("cred-id");
    expect(typeof result.proof.rawId).toBe("string");
    expect(result.proof.rawId).not.toContain("=");
    expect(typeof result.proof.response.clientDataJSON).toBe("string");
    expect(typeof result.proof.response.authenticatorData).toBe("string");
    expect(typeof result.proof.response.signature).toBe("string");
    expect(result.proof.authenticatorAttachment).toBe("platform");
  });

  it("decodes allowCredentials descriptors into ArrayBuffer ids", async () => {
    const el = create({
      ceremony: "authenticate",
      options: {
        challenge: "AAAA",
        allowCredentials: [{ type: "public-key", id: "AAAA", transports: ["internal"] }],
      },
    });
    const done = nextEvent(el, "zl-passkey-result");
    host.appendChild(el);
    await done;

    const arg = credentials.get.mock.calls[0]?.[0] as {
      publicKey: { allowCredentials: Array<{ id: unknown; type: string }> };
    };
    const descriptor = arg.publicKey.allowCredentials[0];
    expect(descriptor?.id).toBeInstanceOf(ArrayBuffer);
    expect(descriptor?.type).toBe("public-key");
  });

  it("aborts the in-flight ceremony when disconnected", async () => {
    credentials.get.mockImplementation(
      (arg: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          arg.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const el = create({ ceremony: "authenticate", options: { challenge: "AAAA" } });
    const errored = nextEvent<{ aborted: boolean }>(el, "zl-passkey-error");
    host.appendChild(el);
    await Promise.resolve();
    el.remove();
    const result = await errored;
    expect(result.aborted).toBe(true);
  });
});
