import { mkdir } from "node:fs/promises";
import { join } from "node:path";

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

      it("checks for a primary origin before syncing IdP connections", async () => {
        const app = await aSetUpApp();
        // A connection the IdP step would create — were it reached. The project
        // has no primary origin, so the deploy must fail before the IdP step
        // writes anything, leaving no connection behind.
        await mkdir(join(app.path, ".zitadel/idps"), { recursive: true });
        await app.writeProjectFile(
          ".zitadel/idps/google.json",
          `${JSON.stringify(
            {
              slug: "google",
              protocol: "oidc",
              template: "google",
              display_name: "Google",
              oidc: {
                issuer: "https://accounts.google.com",
                client_id: "111.apps.googleusercontent.com",
                client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
                scopes: ["openid"],
              },
            },
            null,
            2,
          )}\n`,
        );

        const result = await app.deploy();

        expect(result).toFailWith("E_VALIDATION");
        expect(await app.registeredIdps()).toEqual([]);
      });

      it("refuses a connection whose secret variable the project does not hold", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });
        await app.deleteVariable("GOOGLE_CLIENT_SECRET");

        const result = await app.deploy();

        expect(result).toFailWith("E_CREDENTIAL_MISSING");
      });

      it("refuses an --origin that is not an origin of the project", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        const result = await app.deploy(["--origin", "https://elsewhere.example.com"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses an --origin a preview wildcard covers as a preview", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://*-acme.vercel.app", "preview");

        // The concrete URL is covered by the preview wildcard, not equal to it.
        // An exact-match check would miss it and mislabel it "not an origin";
        // it must be recognised as the preview it is.
        const result = await app.deploy(["--origin", "https://x-acme.vercel.app"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toExplain("is a preview origin");
      });

      it("accepts a primary --origin even when a preview wildcard also covers it", async () => {
        const app = await aSetUpApp();
        await app.addOrigin("https://*-acme.vercel.app", "preview");
        await app.addPrimaryOrigin("https://app-acme.vercel.app");

        // A literal beats a wildcard: the exact primary is a primary target
        // although the preview wildcard would match it too.
        const data = await app.deployData(["--origin", "https://app-acme.vercel.app"]);

        expect(data.origins).toEqual(["https://app-acme.vercel.app"]);
      });

      it("omits the guard on a first deploy, when nothing is live", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();

        // Nothing is deployed yet, so there is no deployment to guard against.
        // The deploy must omit expected_deployment_id entirely: an empty or
        // placeholder id would be rejected by the request schema, so a
        // succeeding first deploy proves the field was left off.
        const data = await app.deployData();

        expect(data.deployment_id).toMatch(/^dep_/);
        const listed = await app.run(["deployment", "list", "--json"]);
        expect(app.envelopeOf<{ count: number }>(listed).data.count).toBe(1);
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

      it("deploys to every primary after a deploy to one of them", async () => {
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

        const result = await app.deploy();

        expect(result).toSucceed();
      });

      it("says a revoked release cannot be deployed rather than reporting a race", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        const first = await app.deployData();
        await app.editUserSchema((schema) => {
          schema.properties.one = { type: "string" };
        });
        await app.deployData();
        await app.run([
          "release",
          "revoke",
          first.release_id ?? "",
          "--force",
          "--non-interactive",
          "--json",
        ]);
        await app.editUserSchema((schema) => {
          delete schema.properties.one;
        });

        const result = await app.deploy();

        expect(result).toExplain("revoked");
      });

      it("fails with a conflict when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy();

        expect(result).toFailWith("E_CONFLICT");
      });

      it("hints at re-running with a message when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin();
        await app.deployData();
        platform.racesTheNextDeploy();

        const result = await app.deploy();

        expect(result).toHintAt("deploy -m");
      });

      it("keeps the --origin in the hint when another deploy lands first", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://a.example.com");
        await app.deployData(["--origin", "https://a.example.com"]);
        platform.racesTheNextDeploy();

        const result = await app.deploy(["--origin", "https://a.example.com"]);

        expect(result).toHintAt("--origin https://a.example.com");
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
