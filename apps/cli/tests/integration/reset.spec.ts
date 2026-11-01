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

    describe("that refuses connections", () => {
      it("still succeeds", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(["reset", "--force", "--json"]);

        expect(result).toSucceed();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toFailWith("E_VALIDATION");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toSuggest("reset --force");
        });

        it("deletes nothing", async () => {
          const app = await aSetUpApp();
          const before = await app.snapshot();

          await app.run(["reset", "--json"]);

          expect(await before.changes()).toMatchObject({ added: [], modified: [], removed: [] });
        });
      });

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
