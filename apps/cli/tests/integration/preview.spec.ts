import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";

type Published = {
  content_hash: string;
  previews: { url: string; expires_at: string | null }[];
  release_env: string;
  dry_run?: boolean;
};

type Listed = { items: { origin: string }[] };

/** Arranges a set-up project that admits {@link PREVIEW_PATTERN} as a preview. */
async function anAppAdmittingPreviews() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  return app;
}

/** Arranges a project whose `preview` environment holds no preview token. */
async function anAppWithoutAPreviewToken() {
  const app = await anApp();
  await app.bindEnvironment("preview", {
    ZITADEL_PROJECT_ID: "proj_preview",
    ZITADEL_PROJECT_SECRET: "sk",
  });
  return app;
}

describe("preview", () => {
  describe("against an invalid server", () => {
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
      it("deploys to the preview URL it is given", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", "1d", "--json"]);

        expect(
          app.envelopeOf<Published>(result).data.previews.map((preview) => preview.url),
        ).toEqual([PREVIEW_URL]);
      });

      it("reports the content hash of what it deployed", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(app.envelopeOf<Published>(result).data.content_hash).toMatch(
          /^sha256:[0-9a-f]{64}$/,
        );
      });

      it("reports the release pin for the build", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(app.envelopeOf<Published>(result).data.release_env).toMatch(
          /^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/,
        );
      });

      it.each(["30s", "31d"])("refuses a ttl of %s, outside the 60s..30d range", async (ttl) => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", ttl, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("lists the preview it deployed", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items.map((preview) => preview.origin)).toEqual([
          PREVIEW_URL,
        ]);
      });

      it("expires the preview after the --ttl it is given", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", "1h", "--json"]);

        expect(
          Date.parse(app.envelopeOf<Published>(result).data.previews[0]?.expires_at ?? "") -
            Date.now(),
        ).toBeLessThan(2 * 60 * 60 * 1000);
      });

      it("deploys when the preview token may not read the project", async () => {
        const app = await anAppAdmittingPreviews();
        platform.refusesProjectReads();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toSucceed();
      });

      it("gives the preview an expiry when --ttl is omitted", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(app.envelopeOf<Published>(result).data.previews[0]?.expires_at).not.toBeNull();
      });

      it("reports a dry run", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--dry-run", "--json"]);

        expect(app.envelopeOf<Published>(result).data.dry_run).toBe(true);
      });

      it("registers no preview on a dry run", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--origin", PREVIEW_URL, "--dry-run", "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items).toEqual([]);
      });

      it("deploys a URL given twice once", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--origin",
          `${PREVIEW_URL}/`,
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(
          app.envelopeOf<Published>(result).data.previews.map((preview) => preview.url),
        ).toEqual([PREVIEW_URL]);
      });

      it("treats a trailing slash on --origin as the same preview URL", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--origin", `${PREVIEW_URL}/`, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items.map((preview) => preview.origin)).toEqual([
          PREVIEW_URL,
        ]);
      });

      it("skips a CI build that names no environment", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], {
          CI: "true",
        });

        expect(result).toBeSkipped();
      });

      it.each([
        ["Jenkins", { JENKINS_URL: "https://ci.example" }],
        ["Cloudflare Pages", { CF_PAGES: "1" }],
        ["Azure Pipelines", { TF_BUILD: "True" }],
        ["AWS CodeBuild", { CODEBUILD_BUILD_ID: "build:1" }],
      ])("skips a %s build that names no environment", async (_, env) => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], env);

        expect(result).toBeSkipped();
      });

      it("refuses a connection file holding a literal client secret", async () => {
        const app = await anAppAdmittingPreviews();
        await app.enableSso("google", {
          clientId: "1234-abc.apps.googleusercontent.com",
          secret: "the-client-secret",
        });
        await app.editConnection("google", (connection) => {
          connection.oidc.client_secret = "a-literal-secret";
        });

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says how to deploy from a CI build that names no environment", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], {
          CI: "true",
        });

        expect(result).toSay("Set ZITADEL_ENV=preview in the pull-request build");
      });

      it("deploys in a CI build that names the preview environment", async () => {
        const app = await anAppAdmittingPreviews();
        await app.bindEnvironment("preview", await app.developmentValues());

        const result = await app.run(
          ["preview", "--env", "preview", "--origin", PREVIEW_URL, "--json"],
          { CI: "true" },
        );

        expect(result).toSucceed();
      });

      it("deploys in a CI build whose ZITADEL_ENV names the preview environment", async () => {
        const app = await anAppAdmittingPreviews();
        await app.bindEnvironment("preview", await app.developmentValues());

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], {
          CI: "true",
          ZITADEL_ENV: "preview",
        });

        expect(result).toSucceed();
      });

      it("refuses the primary origins as a target", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--origin", "primary", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("deploys to the URL the hosting platform announces when no --origin is given", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--json"], { VERCEL_URL: "x-acme.vercel.app" });

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items.map((preview) => preview.origin)).toEqual([
          PREVIEW_URL,
        ]);
      });

      it("refuses a primary origin's own URL as a target", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.run(["preview", "--origin", "https://app.acme.com", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("refuses a ttl outside the range even where it would skip", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--env", "production", "--ttl", "45d", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("fails when no preview URL is given or detected", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
      });

      it("says there is nothing to preview in production without an origin", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--env", "production", "--json"]);

        expect(result).toBeSkipped();
      });

      it("says there is nothing to preview in production even with an origin", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--env",
          "production",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(result).toBeSkipped();
      });

      it("registers no preview in production even with an origin", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--env", "production", "--origin", PREVIEW_URL, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items).toEqual([]);
      });

      it("skips when ZITADEL_PREVIEW_TOKEN is not set", async () => {
        const app = await anAppWithoutAPreviewToken();

        const result = await app.run([
          "preview",
          "--env",
          "preview",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(result).toBeSkipped();
      });

      it("warns naming ZITADEL_PREVIEW_TOKEN when it is not set", async () => {
        const app = await anAppWithoutAPreviewToken();

        const result = await app.run([
          "preview",
          "--env",
          "preview",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(result).toSay("ZITADEL_PREVIEW_TOKEN");
      });

      it("fails naming ZITADEL_PREVIEW_TOKEN under --strict when it is not set", async () => {
        const app = await anAppWithoutAPreviewToken();

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
      });
    });

    describe("rendered for a terminal", () => {
      it("prints the release pin as the last line", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL]);

        expect(result.stdout.trimEnd().split("\n").at(-1)).toMatch(
          /^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/,
        );
      });
    });
  });
});
