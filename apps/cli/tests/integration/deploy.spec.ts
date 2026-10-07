import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

type Deploy = { deployment_id: string; targets: string[]; release: { id: string; content_hash: string } };

describe("deploy", () => {
  describe("against an invalid server", () => {
    it("fails when the server is not a zitadel api", async () => {
      const app = await aSetUpApp();
      platform.isNotZitadel();

      expect(await app.run(["deploy", "--non-interactive", "--json"])).toFailWith("E_NOT_FOUND");
    });

    it("fails when the server is down", async () => {
      const app = await aSetUpApp();
      platform.isUnavailable();

      expect(await app.run(["deploy", "--non-interactive", "--json"])).toFailWith("E_NETWORK");
    });
  });

  describe("against a valid server", () => {
    it("deploys to the project default and every primary origin", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["deploy", "--non-interactive", "--json", "-m", "ship it"]);

      expect(result).toSucceed();
      const { data } = app.envelopeOf<Deploy>(result);
      expect(data.deployment_id).toMatch(/^dep_/);
      expect(data.targets).toContain("");
      expect(data.targets).toContain("http://localhost:3000");
      expect(data.release.content_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("deploys the same .zitadel/ to a second project without local state", async () => {
      const app = await aSetUpApp();
      expect(
        await app.run([
          "env",
          "add",
          "production",
          "--non-interactive",
          "--json",
          "--origin",
          "https://app.acme.com",
        ]),
      ).toSucceed();

      const result = await app.run(["deploy", "--non-interactive", "--json", "--env", "production"]);

      expect(result).toSucceed();
      const { data } = app.envelopeOf<Deploy>(result);
      expect(data.targets).toEqual(expect.arrayContaining(["", "https://app.acme.com"]));
      // The development project was set up first, so the content is already
      // released there; the production project had never seen it and got its
      // own release of the same content.
      const again = app.envelopeOf<Deploy>(
        await app.run(["deploy", "--non-interactive", "--json", "--env", "production"]),
      );
      expect(again.data.release.id).toBe(data.release.id);
    });

    it("prints the digest a build pins", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["deploy", "--non-interactive"]);

      expect(result).toSucceed();
      expect(result.stdout).toMatch(/NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}/);
    });

    it("refuses a preview URL as an origin", async () => {
      const app = await aSetUpApp();
      expect(
        await app.run(["origin", "add", "https://*-acme.vercel.app", "--kind", "preview", "--json"]),
      ).toSucceed();

      const result = await app.run([
        "deploy",
        "--non-interactive",
        "--json",
        "--origin",
        "https://pr-1-acme.vercel.app",
      ]);

      expect(result).toFailWith("E_VALIDATION");
    });

    it("deploys nothing on a dry run", async () => {
      const app = await aSetUpApp();
      const before = await app.run(["deployment", "list", "--json"]);

      expect(await app.run(["deploy", "--non-interactive", "--json", "--dry-run"])).toSucceed();

      const after = await app.run(["deployment", "list", "--json"]);
      expect(app.envelopeOf<{ count: number }>(after).data.count).toBe(
        app.envelopeOf<{ count: number }>(before).data.count,
      );
    });
  });
});
