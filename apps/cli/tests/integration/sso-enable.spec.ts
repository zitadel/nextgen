import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

// `sso enable` is the deprecated alias of `auth-method sso enable` (ADR 069
// §6). The command itself is covered by auth-method-sso-enable.spec.ts; this
// spec covers only what the alias adds.
describe("sso enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.enableSsoDeprecated(GOOGLE, CREDENTIALS)).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.enableSsoDeprecated(GOOGLE, CREDENTIALS)).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("enables the provider the same way auth-method sso enable does", async () => {
        const app = await aSetUpApp();
        expect(await app.enableSsoDeprecated(GOOGLE, CREDENTIALS)).toSucceed();
        expect(await app.apply()).toSucceed();

        const { schema } = await app.publishedSchema();

        expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: true, providers: [GOOGLE] });
      });

      it("names the command to use instead", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDeprecated(GOOGLE, CREDENTIALS);

        expect(app.envelopeOf(result).warnings).toContain(
          "`sso enable` is deprecated. Use `auth-method sso enable`, which takes the same flags.",
        );
      });
    });
  });
});
