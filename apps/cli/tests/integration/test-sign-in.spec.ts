import { describe, expect, it } from "vitest";

import { useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type CustomConnection } from "../helpers/project";

const platform = usePlatformMock();
useLocalServers();

const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};
const CALLBACK_URI = "/__nextgen/idp/google/callback";
const ACME: CustomConnection = {
  slug: "acme-sso",
  displayName: "Acme SSO",
  issuer: "https://sso.acme.example",
};
const ACME_CREDENTIALS = { clientId: "acme-client-id", secret: "acme-client-secret" };

/** A project with two providers, both served by the mock. */
async function anAppWithTwoProviders() {
  const app = await aSetUpApp();
  await app.enableSso("google", CREDENTIALS);
  await app.enableCustomSso(ACME, ACME_CREDENTIALS);
  platform.hasOidcProvider(ACME.issuer);
  return app;
}

describe("test sign-in", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails to read the client ID the connection names", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.isNotZitadel();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails to read the client ID the connection names", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.isUnavailable();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("passes when the provider accepts the connection", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toSucceed();
      });

      it("fails when the provider does not know the callback URI", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ callbackUri: "unregistered" });

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says which callback URI to register", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ callbackUri: "unregistered" });

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toHintAt(CALLBACK_URI);
      });

      it("fails when the provider does not know the client", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ client: "unknown" });

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails when the provider cannot be reached", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.googleIsUnreachable();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses a connection the project does not have", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toExplain("No connection named google");
      });

      it("refuses a live sign-in when the client secret variable is not a secret", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.startLocalServer();
        await app.setVariable("GOOGLE_CLIENT_SECRET", "42");
        platform.hasGoogle();

        const result = await app.run([
          "test",
          "sign-in",
          "--provider",
          "google",
          "--live",
          "--json",
        ]);

        expect(result).toFailWith("E_CREDENTIAL_MISSING");
      });

      it("shows the login URL on stderr while it waits, so an agent can pass it on", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.apply();
        await app.startLocalServer();
        platform.hasGoogle();

        const result = await app.run(
          ["test", "sign-in", "--provider", "google", "--live", "--timeout", "1", "--json"],
          { BROWSER: "none" },
        );

        expect(result.stderr).toContain("/login");
      });

      it("fails a live sign-in that nobody started, pointing at the runtime's log", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.apply();
        await app.startLocalServer();
        platform.hasGoogle();

        const result = await app.run(
          ["test", "sign-in", "--provider", "google", "--live", "--timeout", "1", "--json"],
          { BROWSER: "none" },
        );

        expect(result).toHintAt("zitadel logs");
      });

      it("refuses a live sign-in when the local runtime has never been started", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run([
          "test",
          "sign-in",
          "--provider",
          "google",
          "--live",
          "--json",
        ]);

        expect(result).toExplain("The local Zitadel runtime is not running");
      });
    });

    describe("with several providers", () => {
      it("checks every provider the project has", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--json"]);

        expect(result).toSucceed();
      });

      it("fails when one of them fails, and names it", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasGoogle({ callbackUri: "unregistered" });

        const result = await app.run(["test", "sign-in", "--json"]);

        expect(result).toExplain("google");
      });

      it("checks only the one named", async () => {
        const app = await anAppWithTwoProviders();

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug]);

        expect(result.stdout).not.toContain("accounts.google.com");
      });

      it("refuses a live sign-in, which is one provider's, without a name", async () => {
        const app = await anAppWithTwoProviders();
        await app.startLocalServer();

        const result = await app.run(["test", "sign-in", "--live", "--json"]);

        expect(result).toHintAt("--provider");
      });

      it("shows each provider under its own heading", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in"]);

        expect([result.stdout.includes("acme-sso"), result.stdout.includes("google")]).toEqual([
          true,
          true,
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("prints each check as it ran", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("Discovery document");
      });

      it("shows what the provider reported without letting it drive the terminal", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ issuer: "https://evil.example\u001b]0;pwned\u0007" });

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result.stdout).not.toContain("\u001b]0;");
      });

      it("says the browser sign-in was not asked for", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("a browser sign-in was not asked for");
      });
    });
  });
});
