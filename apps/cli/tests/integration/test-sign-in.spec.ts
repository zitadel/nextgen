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

      it("asks discovery when the authorization endpoint is written empty", async () => {
        const app = await anAppWithTwoProviders();
        await app.editOidc(ACME.slug, { authorization_endpoint: "" });

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug, "--json"]);

        expect(result).toSucceed();
      });

      it("fails a connection that names a token endpoint and nothing else", async () => {
        const app = await anAppWithTwoProviders();
        await app.editOidc(ACME.slug, { token_endpoint: `${ACME.issuer}/token` });

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug, "--json"]);

        expect(result).toHintAt("Name every endpoint");
      });

      it("fails a connection whose own endpoint is not https", async () => {
        const app = await anAppWithTwoProviders();
        await app.editOidc(ACME.slug, {
          authorization_endpoint: "https://sso.acme.example/authorize",
          token_endpoint: "http://sso.acme.example/token",
          jwks_uri: "https://sso.acme.example/jwks",
          userinfo_endpoint: "https://sso.acme.example/userinfo",
        });

        const result = await app.run(["test", "sign-in", "--provider", ACME.slug, "--json"]);

        expect(result).toHintAt("oidc.token_endpoint");
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

      it("refuses a live sign-in when the client secret variable is not set", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.deleteVariable("GOOGLE_CLIENT_SECRET");
        await app.markClaimed();
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

      it("refuses a live sign-in when the client secret variable is not a secret", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.setVariable("GOOGLE_CLIENT_SECRET", "42");
        await app.markClaimed();
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
    });

    describe("--live", () => {
      const ATTEMPT = { auth_attempt_id: "att_1", connection_slug: "google" };
      const LIVE = [
        "test",
        "sign-in",
        "--provider",
        "google",
        "--live",
        "--timeout",
        "10",
        "--json",
      ];

      async function anUnclaimedApp() {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        await app.apply();
        platform.hasGoogle();
        return app;
      }

      async function aSignedUpApp() {
        const app = await anUnclaimedApp();
        await app.markClaimed();
        return app;
      }

      it("passes once the attempt has been handed off", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([
          { event_type: "auth.attempt.created", entity_id: "att_1" },
          { event_type: "auth.sso.exchange.succeeded", payload: ATTEMPT },
          { event_type: "auth.attempt.handed_off", entity_id: "att_1" },
        ]);

        const result = await app.run(LIVE, { BROWSER: "none" });

        expect(result).toSucceed();
      });

      it("gives the attempt and its phases as data in the JSON", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([
          { event_type: "auth.attempt.created", entity_id: "att_1" },
          { event_type: "auth.sso.exchange.succeeded", payload: ATTEMPT },
          { event_type: "auth.attempt.handed_off", entity_id: "att_1" },
        ]);

        const result = await app.run(LIVE, { BROWSER: "none" });

        expect(result.stdout).toContain('"attempt_id": "att_1"');
      });

      it("fails a sign-in the provider refused, naming the callback URI to check", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([
          { event_type: "auth.attempt.created", entity_id: "att_1" },
          {
            event_type: "auth.sso.authorization.failed",
            payload: { ...ATTEMPT, reason: "provider_denied", side: "provider" },
          },
        ]);

        const result = await app.run(LIVE, { BROWSER: "none" });

        expect(result).toHintAt(CALLBACK_URI);
      });

      it("fails a handoff that did not happen, as the journey's", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([
          { event_type: "auth.attempt.created", entity_id: "att_1" },
          {
            event_type: "auth.sso.resolution.failed",
            payload: {
              ...ATTEMPT,
              phase: "handed_off",
              reason: "handoff_failed",
              side: "journey",
            },
          },
        ]);

        const result = await app.run(LIVE, { BROWSER: "none" });

        expect(result).toHintAt("zitadel events list");
      });

      it("fails when nobody signs in, pointing at the events", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([]);

        const result = await app.run(
          ["test", "sign-in", "--provider", "google", "--live", "--timeout", "1", "--json"],
          { BROWSER: "none" },
        );

        expect(result).toHintAt("zitadel events list");
      });

      it("refuses an unclaimed project, whose events are hidden, before it opens anything", async () => {
        const app = await anUnclaimedApp();
        platform.recordsSignIn([]);

        const result = await app.run(LIVE, { BROWSER: "none" });

        expect(result).toHintAt("Claim it");
      });

      it("refuses a dry run of a live sign-in that a real one would refuse", async () => {
        const app = await anAppWithTwoProviders();
        await app.markClaimed();

        const result = await app.run(["test", "sign-in", "--live", "--dry-run", "--json"]);

        expect(result).toHintAt("--provider");
      });

      it("starts nothing on a dry run, since a sign-in can create a user", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([]);

        const result = await app.run([...LIVE, "--dry-run"], { BROWSER: "none" });

        expect(result).toBeSkipped();
      });

      it("does not take a password login for a sign-in with the connection", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([
          { event_type: "auth.attempt.created", entity_id: "att_1" },
          { event_type: "auth.attempt.handed_off", entity_id: "att_1" },
        ]);

        const result = await app.run(
          ["test", "sign-in", "--provider", "google", "--live", "--timeout", "2", "--json"],
          { BROWSER: "none" },
        );

        expect(result).toHintAt("zitadel events list");
      });

      it("shows the login URL on stderr while it waits, so an agent can pass it on", async () => {
        const app = await aSignedUpApp();
        platform.recordsSignIn([]);

        const result = await app.run(
          ["test", "sign-in", "--provider", "google", "--live", "--timeout", "1", "--json"],
          { BROWSER: "none" },
        );

        expect(result.stderr).toContain("/login");
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

      it("refuses a live sign-in, which is one provider's, without a name", async () => {
        const app = await anAppWithTwoProviders();

        const result = await app.run(["test", "sign-in", "--live", "--json"]);

        expect(result).toHintAt("--provider");
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
