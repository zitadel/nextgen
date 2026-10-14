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

      it("finds a prior deployment beyond the server's first page", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");

        // a: R1. Then enough deploys to b that a's own prior deployment sits
        // past the 20-per-page default. Then a again: undoing it must restore a
        // to R1, which is only reachable by paging through the whole history.
        const firstA = await app.deployData(["--origin", "https://a.example.com"]);
        for (let i = 0; i < 21; i += 1) {
          await app.editUserSchema((schema) => {
            schema.properties[`field_${i}`] = { type: "string" };
          });
          await app.deployData(["--origin", "https://b.example.com"]);
        }
        await app.editUserSchema((schema) => {
          schema.properties.last = { type: "string" };
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

      it("refuses a bare rollback that would also move an origin the last deploy never touched", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData(["--origin", "https://a.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.two = { type: "string" };
        });
        await app.deployData(["--origin", "https://b.example.com"]);

        const result = await app.run([
          "deployment",
          "rollback",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("re-applies a named deployment after another origin moved on", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        const first = await app.deployData(["--origin", "https://a.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData(["--origin", "https://a.example.com"]);
        await app.editUserSchema((schema) => {
          schema.properties.two = { type: "string" };
        });
        await app.deployData(["--origin", "https://b.example.com"]);

        const result = await app.run([
          "deployment",
          "rollback",
          first.deployment_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);

        expect(result).toSucceed();
      });

      it("rolls back nothing on a dry run, needing no --force", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.deployData();

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
        // No rollback deployment was written: the history still holds the two
        // deploys and nothing more.
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(2);
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
