import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

const GOOGLE = "google";
const CREDENTIALS = {
  clientId: "1234-abc.apps.googleusercontent.com",
  secret: "the-client-secret",
};

/** A set-up project serving Google, published. */
async function anAppServingGoogle(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.enableSso(GOOGLE, CREDENTIALS)).toSucceed();
  expect(await app.apply()).toSucceed();
  return app;
}

describe("auth-method sso disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still removes the provider", async () => {
        const app = await anAppServingGoogle();
        platform.isNotZitadel();

        expect(await app.disableSso(GOOGLE)).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still removes the provider", async () => {
        const app = await anAppServingGoogle();
        platform.isUnavailable();

        expect(await app.disableSso(GOOGLE)).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("leaves the change for apply to publish", async () => {
        const app = await anAppServingGoogle();

        expect(await app.disableSso(GOOGLE)).toSucceed();

        expect(await app.plan()).not.toReportNothingToDo();
      });

      it("changes nothing for a provider the project does not offer", async () => {
        const app = await aSetUpApp();
        const files = await app.snapshot();

        expect(await app.disableSso(GOOGLE)).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("once applied", () => {
        it("publishes SSO as off", async () => {
          const app = await anAppServingGoogle();
          expect(await app.disableSso(GOOGLE)).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.sso).toEqual({ enabled: false });
        });

        it("stops offering the provider on any step", async () => {
          const app = await anAppServingGoogle();
          expect(await app.disableSso(GOOGLE)).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.stepsOfferingSso()).toEqual([]);
        });

        it("keeps the connection, so enabling it again needs no credentials", async () => {
          const app = await anAppServingGoogle();
          expect(await app.disableSso(GOOGLE)).toSucceed();
          expect(await app.apply()).toSucceed();

          const registered = await app.registeredIdps();

          expect(registered.map((idp) => idp.slug)).toEqual([GOOGLE]);
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anAppServingGoogle();
          expect(await app.disableSso(GOOGLE)).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which provider it removed, and from which schema", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrint("Removed google from default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppServingGoogle();

        const result = await app.disableSsoRendered(GOOGLE);

        expect(result).toPrintNoJson();
      });
    });
  });
});
