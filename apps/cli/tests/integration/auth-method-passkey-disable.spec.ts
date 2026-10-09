import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("auth-method passkey disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey off", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.disableMethod("passkey")).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still turns passkey off", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.disableMethod("passkey")).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("leaves the change for apply to publish", async () => {
        const app = await aSetUpApp();

        expect(await app.disableMethod("passkey")).toSucceed();

        expect(await app.plan()).not.toReportNothingToDo();
      });

      it("refuses on a project whose login starts with a passkey", async () => {
        const app = await aSetUpApp(["--preset", "passkey-first"]);

        expect(await app.disableMethod("passkey")).toFailWith("E_VALIDATION");
      });

      it("changes nothing when passkey is already off", async () => {
        const app = await aSetUpApp();
        expect(await app.disableMethod("passkey")).toSucceed();
        const files = await app.snapshot();

        expect(await app.disableMethod("passkey")).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("once applied", () => {
        it("publishes passkey as off", async () => {
          const app = await aSetUpApp();
          expect(await app.disableMethod("passkey")).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: false });
        });

        it("keeps password on", async () => {
          const app = await aSetUpApp();
          expect(await app.disableMethod("passkey")).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.password).toEqual({ enabled: true });
        });

        it("leaves nothing to reconcile", async () => {
          const app = await aSetUpApp();
          expect(await app.disableMethod("passkey")).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it disabled, and for which schema", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrint("Disabled passkey for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("passkey");

        expect(result).toPrintNoJson();
      });
    });
  });
});
