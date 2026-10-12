import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

describe("deploy", () => {
  describe("against an invalid server", () => {
    // deploy reaches the server to read the live release for the diff and to
    // create the release, so a server that cannot answer fails the command.
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.deploy();

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.deploy();

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("deploys the config to every primary origin", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const data = await app.deployData();

        expect(data.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(data.origins).toEqual(["https://app.acme.com"]);
      });

      it("re-deploys the same release when nothing changed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        const second = await app.deployData();

        expect(second.content_hash).toBe(first.content_hash);
      });

      it("requires -m when non-interactive", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("rejects a blank -m when non-interactive", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.run(["deploy", "--non-interactive", "--json", "-m", "   "]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails when the project has no primary origin", async () => {
        const app = await aSetUpApp();

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses an --origin that is a preview origin", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://*-acme.vercel.app", "preview");

        const result = await app.deploy(["--origin", "https://x-acme.vercel.app"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("passes the observed deployment and re-deploys unchanged content", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();

        // The second deploy observes the first as the live deployment and
        // sends it as expected_deployment_id; nothing changed, so the server
        // answers with the same release rather than a conflict.
        const second = await app.deployData();

        expect(second.content_hash).toBe(first.content_hash);
      });

      it("fails with a conflict when the targets drifted since inspection", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.addPrimaryOrigin("https://b.example.com");
        await app.deployData();

        // Deploying to one origin leaves the other behind, so the two primary
        // origins no longer serve the same deployment.
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData(["--origin", "https://a.example.com"]);

        // A deploy to every primary now finds the origins out of sync with the
        // single deployment it observed, so the optimistic guard rejects it.
        await app.editUserSchema((schema) => {
          schema.properties.two = { type: "string" };
        });
        const result = await app.deploy();

        expect(result).toFailWith("E_CONFLICT");
      });

      it("validates and writes nothing on a dry run", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const dry = await app.deployDryRun();

        expect(dry).toSucceed();
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(0);
      });
    });

    describe("rendered for a terminal", () => {
      it("says what it deployed", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.deployRendered();

        expect(result).toPrint("Deployed sha256:");
      });
    });
  });
});
