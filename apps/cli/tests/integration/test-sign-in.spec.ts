import { describe, expect, it } from "vitest";

import { useLocalServers } from "../helpers/local-server";
import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();
useLocalServers();

const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};
const CALLBACK_URI = "/__nextgen/idp/google/callback";

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

      it("passes when the provider also accepts the client secret", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run([
          "test",
          "sign-in",
          "--provider",
          "google",
          "--client-secret",
          CREDENTIALS.secret,
          "--json",
        ]);

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

      it("fails when the provider rejects the client secret", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle({ secret: "wrong" });

        const result = await app.run([
          "test",
          "sign-in",
          "--provider",
          "google",
          "--client-secret",
          "not-the-secret",
          "--json",
        ]);

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

    describe("rendered for a terminal", () => {
      it("prints each check as it ran", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("Discovery document");
      });

      it("says the client secret was not checked when none was supplied", async () => {
        const app = await aSetUpApp();
        await app.enableSso("google", CREDENTIALS);
        platform.hasGoogle();

        const result = await app.run(["test", "sign-in", "--provider", "google"]);

        expect(result).toPrint("The secret is write-only, so it cannot be read back");
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
