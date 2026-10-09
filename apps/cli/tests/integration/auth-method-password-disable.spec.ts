import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("auth-method password disable", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("refuses without reaching for the server", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.disableMethod("password")).toFailWith("E_VALIDATION");
      });
    });

    describe("that is down", () => {
      it("refuses without reaching for the server", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        expect(await app.disableMethod("password")).toFailWith("E_VALIDATION");
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("refuses while a login flow still asks for a password", async () => {
        const app = await aSetUpApp();

        expect(await app.disableMethod("password")).toFailWith("E_VALIDATION");
      });

      it("leaves the project as it was when it refuses", async () => {
        const app = await aSetUpApp();
        const files = await app.snapshot();

        await app.disableMethod("password");

        expect(await files.changes()).toMatchObject({ added: [], modified: [], removed: [] });
      });

      it("leaves nothing to publish when it refuses", async () => {
        const app = await aSetUpApp();

        await app.disableMethod("password");

        expect(await app.plan()).toReportNothingToDo();
      });
    });

    describe("rendered for a terminal", () => {
      it("says which flow step still asks for a password", async () => {
        const app = await aSetUpApp();

        const result = await app.disableMethodRendered("password");

        expect(result).toSay('step "password"');
      });
    });
  });
});
