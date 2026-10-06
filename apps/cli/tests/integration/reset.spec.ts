import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("reset", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(result).toSucceed();
      });
    });

    describe("that is down", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("succeeds when there is no local runtime to delete", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(result).toSucceed();
      });

      it("succeeds in a directory that was never set up", async () => {
        const app = await anApp();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(result).toSucceed();
      });

      it("leaves the project's committed configuration alone", async () => {
        const app = await aSetUpApp();
        const before = await app.snapshot();

        expect(await app.run(["reset", "--force", "--json"])).toSucceed();

        const { removed } = await before.changes();
        expect(removed).not.toContain("zitadel.json");
        expect(removed).not.toContain(".zitadel/schemas/default-human-user.json");
      });
    });
  });
});
