import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

describe("preview", () => {
  describe("against an invalid server", () => {
    // preview reaches the server to create the release and the deployment, so a
    // server that cannot answer fails the command. `--origin` keeps it from the
    // production no-op path so it does reach the server.
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toFail();
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toFail();
      });
    });
  });

  describe("against a valid server", () => {
    describe("--json", () => {
      it("deploys to the preview URL it is given, for the ttl", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", "1d", "--json"]);

        expect(result).toSucceed();
        const data = app.envelopeOf<{
          content_hash: string;
          previews: { url: string; expires_at: string | null }[];
          release_env: string;
        }>(result).data;
        expect(data.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(data.previews.map((preview) => preview.url)).toEqual([PREVIEW_URL]);
        expect(data.release_env).toBe(`NEXT_PUBLIC_ZITADEL_RELEASE=${data.content_hash}`);
      });

      it("lists the preview it deployed", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");
        await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);

        expect(listed).toSucceed();
        expect(
          app
            .envelopeOf<{ items: { origin: string }[] }>(listed)
            .data.items.map((preview) => preview.origin),
        ).toEqual([PREVIEW_URL]);
      });

      it("defaults the ttl the server applies when --ttl is omitted", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toSucceed();
        // Omitting --ttl leaves it to the server default, which still gives the
        // written preview a future expiry.
        const data = app.envelopeOf<{ previews: { expires_at: string | null }[] }>(result).data;
        expect(data.previews[0]?.expires_at).not.toBeNull();
        expect(new Date(data.previews[0]?.expires_at as string).getTime()).toBeGreaterThan(
          Date.now(),
        );
      });

      it("says there is nothing to preview in production without an origin", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--env", "production", "--json"]);

        expect(result).toBeSkipped();
      });

      it("says there is nothing to preview in production even with an origin", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");

        // An explicit origin selects targets; it never authorizes a preview
        // deploy into production, which `zitadel deploy` owns. The command must
        // skip without writing, so the project has no preview afterwards.
        const result = await app.run([
          "preview",
          "--env",
          "production",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(result).toBeSkipped();
        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("warns and exits cleanly when ZITADEL_PREVIEW_TOKEN is not set", async () => {
        // A fork pull-request build cannot read the preview secret, so a missing
        // token skips the preview rather than failing the build (#1312). The
        // project secret is present but is never a stand-in.
        const app = await anApp();
        await app.bindEnvironment("preview", {
          ZITADEL_PROJECT_ID: "proj_preview",
          ZITADEL_PROJECT_SECRET: "sk",
        });

        const result = await app.run([
          "preview",
          "--env",
          "preview",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(result).toBeSkipped();
        // The warning rides the skipped envelope's `warnings`, so an agent
        // reading --json still sees why nothing was deployed.
        expect(result).toSay("ZITADEL_PREVIEW_TOKEN");
        const warnings = (JSON.parse(result.stdout) as { warnings?: string[] }).warnings;
        expect(warnings).toEqual([expect.stringContaining("ZITADEL_PREVIEW_TOKEN")]);
      });

      it("fails naming ZITADEL_PREVIEW_TOKEN under --strict when it is not set", async () => {
        const app = await anApp();
        await app.bindEnvironment("preview", {
          ZITADEL_PROJECT_ID: "proj_preview",
          ZITADEL_PROJECT_SECRET: "sk",
        });

        const result = await app.run([
          "preview",
          "--env",
          "preview",
          "--origin",
          PREVIEW_URL,
          "--strict",
          "--json",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(result).toSay("ZITADEL_PREVIEW_TOKEN");
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the release pin as the last line", async () => {
        const app = await aSetUpApp();
        await app.addOrigin(PREVIEW_PATTERN, "preview");

        const result = await app.run(["preview", "--origin", PREVIEW_URL]);

        expect(result).toSucceed();
        const lines = result.stdout.trimEnd().split("\n");
        expect(lines.at(-1)).toMatch(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/);
      });
    });
  });
});
