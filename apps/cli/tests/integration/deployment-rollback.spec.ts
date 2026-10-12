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

      it("undoes the latest deploy from that origin's own history", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        // a: R1, then b: R2, then a: R3. The project-wide second-newest is the
        // b deploy, but undoing the latest a deploy must restore a to R1.
        const firstA = await app.deployData(["--origin", "https://a.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData(["--origin", "https://b.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.two = { type: "string" };
        });
        await app.deployData(["--origin", "https://a.example.com"]);

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
        expect(app.envelopeOf<{ release_id: string }>(result).data.release_id).toBe(
          firstA.release_id,
        );
      });

      it("refuses a bare rollback when the latest deploy's origins diverge", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const onA = await app.deployData(["--origin", "https://a.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData(["--origin", "https://b.example.com"]);

        // A low-level create (no optimistic guard) makes a deployment that
        // touches both origins at once, though a and b were last served by
        // different deployments. Its bare rollback has no single prior.
        const created = await app.run([
          "deployment",
          "create",
          "--release",
          onA.release_id ?? "",
          "--non-interactive",
          "--json",
        ]);
        expect(created).toSucceed();

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
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
