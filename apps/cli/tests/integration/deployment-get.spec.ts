import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp } from "@tests/helpers/project";
import { asTerminal, RENDERINGS } from "@tests/helpers/terminal";

const platform = usePlatformMock();

describe("deployment get", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "get",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      await app.addPrimaryOrigin();
      const deployed = await app.deployData();
      platform.servesAHostileOrigin();
      const args = ["deployment", "get", deployed.deployment_id ?? ""];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("reads back a deployment by id", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
        const data = app.envelopeOf<{ id: string; release_id: string }>(result).data;
        expect(data.id).toBe(deployed.deployment_id);
        expect(data.release_id).toBe(deployed.release_id);
        // The whole record, not the fields this test happens to read: the
        // entity names fewer of them as its own.
        expect(data).toCarryTheDeploymentRecord();
      });

      // `--json` answers the record and renders nothing, so it reads no
      // variables and takes no permission to read them. Only the rendering
      // shows them, and only it needs that permission.
      it("answers a credential that may not read variables, because it shows none", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const deployed = await app.deployData();
        platform.refusesVariableReads();

        const result = await app.run(["deployment", "get", deployed.deployment_id ?? "", "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result).data).toCarryTheDeploymentRecord();
      });

      it("reports an unknown deployment as not found", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "get",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--json",
        ]);

        expect(result).toFail();
      });
    });

    describe("rendered for a terminal", () => {
      // The summary names the origins the server answered with.
      it.each(RENDERINGS)(
        "spells out an escape sequence the server put in an origin, %s",
        async (_how, colour) => {
          const app = await aSetUpApp();
          await app.addPrimaryOrigin();
          const deployed = await app.deployData();
          platform.servesAHostileOrigin();

          const result = await asTerminal(() =>
            app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
          );

          expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
          expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
        },
      );

      it.each(RENDERINGS)("shows the variables the deployment froze, %s", async (_how, colour) => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.setVariable("HOST", "app.acme.com");
        const deployed = await app.deployData();

        const result = await asTerminal(() =>
          app.run(["deployment", "get", deployed.deployment_id ?? ""], colour),
        );

        expect(result).toPrintRow("HOST", "app.acme.com");
      });
    });
  });
});
