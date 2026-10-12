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

      it("fails when there is no earlier deployment", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();

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
        await app.deployData();

        const result = await app.run([
          "deployment",
          "rollback",
          "dep_01KX5N7C9D2E7F0N9WD3P2E4YM6",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });
    });
  });
});
