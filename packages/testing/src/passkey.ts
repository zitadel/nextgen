import type { CDPSession, Page } from "@playwright/test";

/**
 * A virtual WebAuthn authenticator attached to one page. Ceremonies started
 * from that page (passkey registration, passkey login) complete automatically
 * — no OS authenticator dialog, no touch.
 */
export interface VirtualPasskey {
  /** CDP id of the virtual authenticator, for advanced raw-protocol use. */
  authenticatorId: string;
  /** Number of credentials the authenticator currently stores. */
  credentialCount(): Promise<number>;
  /** Remove the authenticator and detach the CDP session. */
  dispose(): Promise<void>;
}

/**
 * Attach a virtual passkey authenticator to the page via the Chrome DevTools
 * Protocol. The options mirror a platform authenticator with discoverable
 * credentials and automatic user presence — the profile the consumer journey
 * has run in CI since passkey coverage became mandatory there.
 *
 * Chromium only: the CDP WebAuthn domain does not exist in WebKit or Firefox.
 * The authenticator is bound to this page — drive registration and the later
 * login from the same page, or the credential is gone. Serve the app under
 * test on an origin WebAuthn accepts as a relying-party ID: HTTPS on a real
 * domain, or `http://localhost` for local runs — raw IP origins such as
 * `http://127.0.0.1` are invalid RP IDs.
 */
export async function enableVirtualPasskey(page: Page): Promise<VirtualPasskey> {
  let client: CDPSession;
  try {
    client = await page.context().newCDPSession(page);
  } catch (error) {
    throw new Error(
      "enableVirtualPasskey: could not open a CDP session — passkey testing " +
        "needs Chromium's virtual authenticator, so run passkey specs in a " +
        "Chromium project.",
      { cause: error },
    );
  }
  let authenticatorId: string;
  try {
    await client.send("WebAuthn.enable");
    ({ authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    }));
  } catch (error) {
    // Don't leave a half-initialized CDP session attached behind a throw.
    await client.detach().catch(() => undefined);
    throw error;
  }

  return {
    authenticatorId,
    async credentialCount() {
      const { credentials } = await client.send("WebAuthn.getCredentials", {
        authenticatorId,
      });
      return credentials.length;
    },
    async dispose() {
      // Best-effort: the page (and with it the CDP target) may already be
      // gone when teardown runs after a failed test; never mask that failure.
      // Detach even when the removal fails, so the session never outlives it.
      try {
        await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      } catch {
        // ignore
      } finally {
        await client.detach().catch(() => undefined);
      }
    },
  };
}
