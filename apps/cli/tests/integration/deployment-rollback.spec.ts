import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("deployment rollback", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("undoes the last deploy, re-serving the earlier release", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        const second = await app.deployData();
        expect(second.release_id).not.toBe(first.release_id);

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ release_id: string }>(result).data.release_id).toBe(
          first.release_id,
        );
      });

      it("records -m on the rollback", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "-m",
          "company broke sign-up",
          "--non-interactive",
          "--json",
        ]);

        const { deployment_id } = app.envelopeOf<{ deployment_id: string }>(result).data;
        expect(await app.deploymentMessage(deployment_id)).toBe("company broke sign-up");
      });

      it("guards a bare rollback with the deployment it undoes", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        const undone = await app.deployData();
        const rollbacks = platform.capturesRollbacks();

        await app.run(["deployment", "rollback", "--force", "--non-interactive", "--json"]);

        expect(rollbacks.last?.expected_deployment_id).toBe(undone.deployment_id);
      });

      it("refuses re-applying a deployment to an origin since removed as a validation error", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const first = await app.deployData();
        await app.removeOrigin("https://b.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("takes no --origin, as every primary deployment is one history", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.example.com");

        const result = await app.run([
          "deployment",
          "rollback",
          "--origin",
          "https://app.example.com",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("undoes the last deploy, not a preview deployed after it", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData();
        await app.previewData("https://x-acme.vercel.app");

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(app.envelopeOf<{ release_id: string }>(result).data.release_id).toBe(
          first.release_id,
        );
      });

      it("rolls back nothing on a dry run, needing no --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();
        const before = await app.liveDeploymentCount();

        // A dry run is exempt from the destructive-confirm gate, so it succeeds
        // without --force even non-interactively.
        const result = await app.run([
          "deployment",
          "rollback",
          "--dry-run",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ dry_run: boolean }>(result).data.dry_run).toBe(true);
        // No rollback deployment was written: the history holds what it held.
        expect(await app.liveDeploymentCount()).toBe(before);
      });

      it("fails when there is no earlier deployment", async () => {
        // Setup's deployment is the only one.
        const app = await aSetUpApp();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("requires --force when non-interactive", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });
});
