import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "../helpers/project";

const platform = usePlatformMock();

/** A set-up project with passkey turned off, so enabling it has something to do. */
async function anAppWithoutPasskey(): Promise<ScaffoldedApp> {
  const app = await aSetUpApp();
  expect(await app.authMethod("passkey", "disable")).toSucceed();
  return app;
}

describe("auth-method passkey enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still turns passkey on, for apply to publish once it is back", async () => {
        const app = await anAppWithoutPasskey();
        platform.isNotZitadel();

        expect(await app.authMethod("passkey", "enable")).toSucceed();

        platform.recovers();
        expect(await app.apply()).toSucceed();
        const { schema } = await app.publishedSchema();
        expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
      });
    });

    describe("that is down", () => {
      it("still turns passkey on, for apply to publish once it is back", async () => {
        const app = await anAppWithoutPasskey();
        platform.isUnavailable();

        expect(await app.authMethod("passkey", "enable")).toSucceed();

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

        expect(await app.authMethod("passkey", "enable")).toSucceed();

        expect(await app.plan()).not.toReportNothingToDo();
      });

      it("previews without writing under --dry-run", async () => {
        const app = await anAppWithoutPasskey();
        const files = await app.snapshot();

        expect(await app.authMethod("passkey", "enable", ["--dry-run"])).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      describe("once applied", () => {
        it("publishes passkey as on", async () => {
          const app = await anAppWithoutPasskey();
          expect(await app.authMethod("passkey", "enable")).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.passkey).toEqual({ enabled: true });
        });

        it("leaves nothing to reconcile", async () => {
          const app = await anAppWithoutPasskey();
          expect(await app.authMethod("passkey", "enable")).toSucceed();
          expect(await app.apply()).toSucceed();

          expect(await app.plan()).toReportNothingToDo();
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it enabled, and for which schema", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.authMethodRendered("passkey", "enable");

        expect(result).toSucceed();
        expect(result).toPrint("Enabled passkey for default-human-user");
      });

      it("warns when no login flow offers passkey yet", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.authMethodRendered("passkey", "enable");

        expect(result.stderr).toContain("No login flow for default-human-user offers passkey yet");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await anAppWithoutPasskey();

        const result = await app.authMethodRendered("passkey", "enable");

        expect(result).toPrintNoJson();
      });
    });
  });
});
