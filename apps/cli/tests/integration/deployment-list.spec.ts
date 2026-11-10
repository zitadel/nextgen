import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anUndeployedEnvironment, aSetUpApp, SETUP_ORIGIN } from "@tests/helpers/project";
import { asTerminal, offTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

const DEFAULT_ENVIRONMENT = "development";

describe("deployment list", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        expect(await app.run(["deployment", "list", "--json"])).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      await app.deployData();
      platform.servesAHostileOrigin();

      await app.inEveryRendering((how) =>
        app.run(how.json ? ["deployment", "list", "--json"] : ["deployment", "list"], how.env),
      );
    });

    describe("--json", () => {
      it("is empty before anything is deployed", async () => {
        const app = await anUndeployedEnvironment();

        const result = await app.run(["deployment", "list", "--env", "staging", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(0);
      });

      it("emits the canonical list envelope", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "list", "--json"]);

        expect(result).toSucceed();
        // The envelope carries `items` (not `deployments`), a `count`, and a
        // `next_page_token` that is null on the last page — the same shape the
        // shared list commands emit.
        const { data } = app.envelopeOf<{
          items: { id: string; release_id: string }[];
          count: number;
          next_page_token: string | null;
        }>(result);
        // Setup's deployment, then this one, newest first.
        expect(data.count).toBe(2);
        expect(data.items).toHaveLength(2);
        expect(data.items[0]?.release_id).toBe(deployed.release_id);
        expect(data.next_page_token).toBeNull();
        // Every item carries the whole record, not the fields this test happens
        // to read: the entity names fewer of them as its own.
        for (const item of data.items) {
          expect(item).toCarryTheDeploymentRecord();
        }
      });

      it("suggests the next page, repeating the limit", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run(["deployment", "list", "--limit", "1", "--json"]);

        expect(result).toSuggest("deployment list --limit 1 --page-token");
      });

      it("keeps the environment when suggesting the next page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run([
          "deployment",
          "list",
          "--env",
          DEFAULT_ENVIRONMENT,
          "--limit",
          "1",
          "--json",
        ]);

        expect(result).toSuggest(`--env ${DEFAULT_ENVIRONMENT}`);
      });

      it("repeats the origin when suggesting the next page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run([
          "deployment",
          "list",
          "--origin",
          SETUP_ORIGIN.pattern,
          "--limit",
          "1",
          "--json",
        ]);

        expect(result).toSuggest(
          `deployment list --origin ${SETUP_ORIGIN.pattern} --limit 1 --page-token`,
        );
      });

      it("drains the history with --all", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

        const result = await app.run(["deployment", "list", "--all", "--limit", "1", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ count: number }>(result).data.count).toBe(2);
      });
    });

    describe("rendered for a terminal", () => {
      it.each(RENDERINGS)("prints the deployed release, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await asTerminal(() => app.run(["deployment", "list"], colour));

        expect(result).toPrint(deployed.release_id ?? "");
      });

      it.each(RENDERINGS)("spells out an origin the server answered, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.servesAHostileOrigin();

        const result = await asTerminal(() => app.run(["deployment", "list"], colour));

        expect(result).toSucceed();
        expect(result.stdout).not.toContain("\u001b[2J");
      });
    });

    describe("--plain", () => {
      it("prints each deployment as a tab-separated record, piped", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await offTerminal(() => app.run(["deployment", "list", "--plain"]));

        expect(result).toPrintPlainRow(/.+/, deployed.release_id ?? "", /.*/, /.+/, /.+/);
      });

      it("prints nothing before anything is deployed, piped", async () => {
        const app = await anUndeployedEnvironment();

        const result = await offTerminal(() =>
          app.run(["deployment", "list", "--env", "staging", "--plain"]),
        );

        expect(result).toSucceed();
        expect(result).toPrintPlainRows();
      });
    });
  });
});
