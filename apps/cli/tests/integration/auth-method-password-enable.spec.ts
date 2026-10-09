import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("auth-method password enable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.authMethod("password", "enable")).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds, because it never reaches for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.authMethod("password", "enable")).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses a schema with no x-identifier to check a password against", async () => {
        const app = await aSetUpApp();
        await app.editUserSchema((schema) => {
          delete (schema as { "x-identifier"?: string })["x-identifier"];
          schema["x-auth-methods"] = { ...schema["x-auth-methods"], password: { enabled: false } };
        });

        expect(await app.authMethod("password", "enable")).toFailWith("E_VALIDATION");
      });

      it("changes nothing when password is already on", async () => {
        const app = await aSetUpApp();
        const files = await app.snapshot();

        expect(await app.authMethod("password", "enable")).toSucceed();

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("leaves nothing to publish when password is already on", async () => {
        const app = await aSetUpApp();

        expect(await app.authMethod("password", "enable")).toSucceed();

        expect(await app.plan()).toReportNothingToDo();
      });

      describe("once applied", () => {
        it("publishes password as on after it was switched off by hand", async () => {
          const app = await aSetUpApp();
          await app.editUserSchema((schema) => {
            schema["x-auth-methods"] = {
              ...schema["x-auth-methods"],
              password: { enabled: false },
            };
          });
          expect(await app.authMethod("password", "enable")).toSucceed();
          expect(await app.apply()).toSucceed();

          const { schema } = await app.publishedSchema();

          expect(schema["x-auth-methods"]?.password).toEqual({ enabled: true });
        });
      });
    });

    describe("rendered for a terminal", () => {
      it("says there was nothing to enable", async () => {
        const app = await aSetUpApp();

        const result = await app.authMethodRendered("password", "enable");

        expect(result).toPrint("Nothing to enable for default-human-user");
      });

      it("renders text rather than a json envelope", async () => {
        const app = await aSetUpApp();

        const result = await app.authMethodRendered("password", "enable");

        expect(result).toPrintNoJson();
      });
    });
  });
});
