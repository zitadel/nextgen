import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("auth-factor disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns the factor off, for apply to publish once it is back", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.disableFactors(["passkey"])).toSucceed();

        platform.recovers();
        expect(await app.apply()).toSucceed();
        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: false });
      });
    });

    describe("that is down", () => {
      it("still turns the factor off, for apply to publish once it is back", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.disableFactors(["passkey"])).toSucceed();

        platform.recovers();
        expect(await app.apply()).toSucceed();
        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: false });
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("leaves the change for apply to publish", async () => {
        const app = await aSetUpApp();

        expect(await app.disableFactors(["passkey"])).toSucceed();

        expect(await app.plan()).not.toReportNothingToDo();
      });

      it("refuses a factor a login flow still asks for", async () => {
        const app = await aSetUpApp();

        expect(await app.disableFactors(["password"])).toFailWith("E_VALIDATION");
      });

      it("leaves the project as it was when it refuses", async () => {
        const app = await aSetUpApp();
        const files = await app.snapshot();

        await app.disableFactors(["password"]);

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("refuses passkey on a project whose login starts with a passkey", async () => {
        const app = await aSetUpApp(["--preset", "passkey-first"]);

        expect(await app.disableFactors(["passkey"])).toFailWith("E_VALIDATION");
      });

      it("changes nothing when the factor is already off", async () => {
        const app = await aSetUpApp();
        expect(await app.disableFactors(["passkey"])).toSucceed();
        const files = await app.snapshot();

        expect(await app.disableFactors(["passkey"])).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("once applied", () => {
        it("publishes the factor as off", async () => {
          const app = await aSetUpApp();
          expect(await app.disableFactors(["passkey"])).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: false });
        });

        it("keeps the other factors on", async () => {
          const app = await aSetUpApp();
          expect(await app.disableFactors(["passkey"])).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.password).toEqual({ enabled: true });
        });

        it("leaves nothing to reconcile", async () => {
          const app = await aSetUpApp();
          expect(await app.disableFactors(["passkey"])).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which factor it disabled, and for which schema", async () => {
        const app = await aSetUpApp();

        const result = await app.toggleFactorsRendered("disable", ["passkey"]);

        expect(result).toSucceed();
        expect(result).toPrint("Disabled passkey for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.toggleFactorsRendered("disable", ["passkey"]);

        expect(result).toPrintNoJson();
      });
    });
  });
});
