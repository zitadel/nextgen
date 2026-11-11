import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { useLocalServers } from "@tests/helpers/local-server";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";

const platform = usePlatformMock();
useLocalServers();

/** The two ways a person reads a run, which must say the same thing. */
const SHOWN = [
  ["on a terminal", asTerminal],
  ["piped", offTerminal],
] as const;

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
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      const args = ["reset", "--force"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      describe("without --force when no one can be asked", () => {
        it("is refused", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toFailWith("E_CONFIRMATION_REQUIRED");
        });

        it("says to pass --force", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toHintAt("--force");
        });

        it("suggests running it again with --force", async () => {
          const app = await aSetUpApp();

          const result = await app.run(["reset", "--json"]);

          expect(result).toSuggestExactly(app.againAsRun("reset --force"));
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

      it("does not claim in a dry run that the data was deleted", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["reset", "--dry-run", "--json"]);

        expect(
          app.envelopeOf<{ runtime: { data_deleted: boolean } }>(result).data.runtime,
        ).toMatchObject({
          data_deleted: false,
        });
      });
    });

    describe.each(SHOWN)("rendered %s", (_how, shown) => {
      it("names the process it reset", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["reset", "--force"]));

        expect(result).toPrint(String(app.localPidOf(started)));
      });

      it("names the process it would reset", async () => {
        const app = await aSetUpApp();
        const started = await app.startLocalServer();

        const result = await shown(() => app.run(["reset", "--dry-run"]));

        expect(result).toPrint(String(app.localPidOf(started)));
      });
    });
  });
});
