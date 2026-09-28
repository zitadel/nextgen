import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";

import { enableVirtualPasskey } from "../../src/passkey";

interface FakeCdp {
  calls: Array<{ method: string; params?: unknown }>;
  detached: boolean;
  page: Page;
  failSend?: (method: string) => Error | undefined;
}

function fakeCdpPage(overrides: Partial<Pick<FakeCdp, "failSend">> = {}): FakeCdp {
  const fake: FakeCdp = {
    calls: [],
    detached: false,
    failSend: overrides.failSend,
    page: undefined as unknown as Page,
  };
  const client = {
    async send(method: string, params?: unknown) {
      const failure = fake.failSend?.(method);
      if (failure) {
        throw failure;
      }
      fake.calls.push({ method, params });
      if (method === "WebAuthn.addVirtualAuthenticator") {
        return { authenticatorId: "auth_1" };
      }
      if (method === "WebAuthn.getCredentials") {
        return { credentials: [{ credentialId: "c1" }, { credentialId: "c2" }] };
      }
      return {};
    },
    async detach() {
      fake.detached = true;
    },
  };
  fake.page = {
    context: () => ({ newCDPSession: async () => client }),
  } as unknown as Page;
  return fake;
}

describe("enableVirtualPasskey", () => {
  it("adds the journey-proven authenticator profile and reads credentials", async () => {
    const fake = fakeCdpPage();
    const passkey = await enableVirtualPasskey(fake.page);

    // The exact CDP sequence and options the consumer journey runs in CI:
    // a platform authenticator with discoverable credentials and automatic
    // user presence. Changing any flag changes which ceremonies complete.
    expect(fake.calls).toEqual([
      { method: "WebAuthn.enable", params: undefined },
      {
        method: "WebAuthn.addVirtualAuthenticator",
        params: {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        },
      },
    ]);
    expect(passkey.authenticatorId).toBe("auth_1");

    await expect(passkey.credentialCount()).resolves.toBe(2);
    expect(fake.calls.at(-1)).toEqual({
      method: "WebAuthn.getCredentials",
      params: { authenticatorId: "auth_1" },
    });
  });

  it("removes the authenticator and detaches on dispose", async () => {
    const fake = fakeCdpPage();
    const passkey = await enableVirtualPasskey(fake.page);

    await passkey.dispose();
    expect(fake.calls.at(-1)).toEqual({
      method: "WebAuthn.removeVirtualAuthenticator",
      params: { authenticatorId: "auth_1" },
    });
    expect(fake.detached).toBe(true);
  });

  it("swallows teardown errors and still detaches the session", async () => {
    const fake = fakeCdpPage({
      failSend: (method) =>
        method === "WebAuthn.removeVirtualAuthenticator"
          ? new Error("Target closed")
          : undefined,
    });
    const passkey = await enableVirtualPasskey(fake.page);

    await expect(passkey.dispose()).resolves.toBeUndefined();
    expect(fake.detached).toBe(true);
  });

  it("detaches the session when initialization fails after it opened", async () => {
    const fake = fakeCdpPage({
      failSend: (method) =>
        method === "WebAuthn.enable" ? new Error("WebAuthn domain unavailable") : undefined,
    });

    await expect(enableVirtualPasskey(fake.page)).rejects.toThrow("WebAuthn domain unavailable");
    expect(fake.detached).toBe(true);
  });

  it("explains the Chromium requirement when no CDP session is available", async () => {
    const page = {
      context: () => ({
        newCDPSession: async () => {
          throw new Error("CDP session is only available in Chromium");
        },
      }),
    } as unknown as Page;

    await expect(enableVirtualPasskey(page)).rejects.toThrow(
      /Chromium's virtual authenticator/,
    );
  });
});
