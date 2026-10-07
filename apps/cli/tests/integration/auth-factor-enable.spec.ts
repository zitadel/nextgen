import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A set-up project with passkey turned off, so enabling it has something to do. */
async function anAppWithoutPasskey(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.disableFactors(["passkey"])).toSucceed();
  return app;
}

describe("auth-factor enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns the factor on, for apply to publish once it is back", async () => {
        const app = await anAppWithoutPasskey();
        platform.isNotZitadel();

        expect(await app.enableFactors(["passkey"])).toSucceed();

        platform.recovers();
        expect(await app.apply()).toSucceed();
        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
      });
    });

    describe("that is down", () => {
      it("still turns the factor on, for apply to publish once it is back", async () => {
        const app = await anAppWithoutPasskey();
        platform.isUnavailable();

        expect(await app.enableFactors(["passkey"])).toSucceed();

        platform.recovers();
        expect(await app.apply()).toSucceed();
        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("leaves the change for apply to publish", async () => {
        const app = await anAppWithoutPasskey();
        expect(await app.apply()).toSucceed();

        expect(await app.enableFactors(["passkey"])).toSucceed();

        expect(await app.plan()).not.toReportNothingToDo();
      });

      it("changes nothing when the factor is already on", async () => {
        const app = await aSetUpApp();
        const files = await app.snapshot();

        expect(await app.enableFactors(["password"])).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("leaves nothing to publish when the factor is already on", async () => {
        const app = await aSetUpApp();

        expect(await app.enableFactors(["password"])).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      it("previews without writing under --dry-run", async () => {
        const app = await anAppWithoutPasskey();
        const files = await app.snapshot();

        expect(await app.enableFactors(["passkey"], ["--dry-run"])).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("once applied", () => {
        it("publishes the factor as on", async () => {
          const app = await anAppWithoutPasskey();
          expect(await app.enableFactors(["passkey"])).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anAppWithoutPasskey();
          expect(await app.enableFactors(["passkey"])).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says which factor it enabled, and for which schema", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.toggleFactorsRendered("enable", ["passkey"]);

        expect(result).toSucceed();
        expect(result).toPrint("Enabled passkey for default-human-user");
      });

      it("warns when no login flow offers the factor yet", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.toggleFactorsRendered("enable", ["passkey"]);

        expect(result.stderr).toContain("No login flow for default-human-user offers passkey yet");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.toggleFactorsRendered("enable", ["passkey"]);

        expect(result).toPrintNoJson();
      });
    });
  });
});
