import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

describe("sso enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        await app.enableSsoDeprecated(GOOGLE, CREDENTIALS);

        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          "${{ GOOGLE_CLIENT_ID }}",
        );
      });
    });

    describe("that is down", () => {
      it("still writes the provider into the project", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        await app.enableSsoDeprecated(GOOGLE, CREDENTIALS);

        expect((await app.committed.idpConnection(GOOGLE)).oidc.client_id).toBe(
          "${{ GOOGLE_CLIENT_ID }}",
        );
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      describe("once applied", () => {
        it("offers the provider in the published schema", async () => {
          const app = await aSetUpApp();
          expect(await app.enableSsoDeprecated(GOOGLE, CREDENTIALS)).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: true, providers: [GOOGLE] });
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("names the command to use instead", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDeprecatedRendered(GOOGLE, CREDENTIALS);

        expect(result).toSay("Use `auth-method sso enable`");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.enableSsoDeprecatedRendered(GOOGLE, CREDENTIALS);

        expect(result).toPrintNoJson();
      });
    });
  });
});
