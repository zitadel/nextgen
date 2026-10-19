import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type CustomConnection } from "../helpers/project";

const platform = usePlatformMock();

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

      it("points at the command to run next", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ client: "unknown" });

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toSuggest("test sign-in --provider google");
      });

      it("asks the provider about a Google connection that has been given another name", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.reslugConnection("google", "google-work");
        platform.hasGoogle({ client: "unknown" });

        const result = await app.run(["test", "sign-in", "--provider", "google-work", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails a connection that names only some of its endpoints", async () => {
        const app = await anAppWithTwoProviders();
        await app.editOidc(ACME.slug, { authorization_endpoint: `${ACME.issuer}/authorize` });

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug, "--json"]);

        expect(result).toHintAt("Name every endpoint");
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

      it("fails a provider whose discovery document is larger than the CLI will read", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasOversizedDiscovery(ACME.issuer);

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug, "--json"]);

        expect(result.stdout).toContain("more than");
      });

      it("refuses a connection the project does not have", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["test", "sign-in", "--provider", "google", "--json"]);

        expect(result).toExplain("No connection named google");
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

        expect(`${result.stdout}${result.stderr}`).not.toContain("accounts.google.com");
      });

      it("shows each provider under its own heading", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in"]);

        const said = `${result.stdout}${result.stderr}`;
        expect([said.includes("Checking acme-sso"), said.includes("Checking google")]).toEqual([
          true,
          true,
        ]);
      });
    });

    describe("rendered for a terminal", () => {
      it("opens with the project and the server, like the other commands", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("Server");
      });

      it("prints each check as it ran", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("Discovery document: Fetched");
      });

      it("closes with a summary of what each provider's checks came to", async () => {
        const app = await anAppWithTwoProviders();
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in"]);

        expect(result).toPrint("Sign-in checks");
      });

      it("shows what the provider reported without letting it drive the terminal", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ issuer: "https://evil.example\u001b]0;pwned\u0007" });

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(`${result.stdout}${result.stderr}`).not.toContain("\u001b]0;");
      });
    });
  });
});
