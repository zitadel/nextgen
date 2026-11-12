import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { anApp, aSetUpApp } from "@tests/helpers/project";
import { expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { CREDENTIALS, PREVIEW_CREDENTIAL } from "@/lib/oclif";

const platform = usePlatformMock();

const PREVIEW_PATTERN = "https://*-acme.vercel.app";
const PREVIEW_URL = "https://x-acme.vercel.app";
const OTHER_URL = "https://y-acme.vercel.app";

const UNNAMED_CI_WARNING =
  "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.";

type Listed = { items: { origin: string }[] };

/** Arranges a set-up project that admits {@link PREVIEW_PATTERN} as a preview. */
async function anAppAdmittingPreviews() {
  const app = await aSetUpApp();
  await app.addOrigin(PREVIEW_PATTERN, "preview");
  return app;
}

/**
 * Arranges a project whose `preview` environment holds no preview credential.
 * Which variable that is follows the credential the preview commands present
 * ({@link PREVIEW_CREDENTIAL}), so the environment is bound without it.
 */
async function anAppWithoutAPreviewCredential() {
  const app = await anApp();
  await app.bindEnvironment("preview", {
    ZITADEL_PROJECT_ID: "proj_preview",
    ...(PREVIEW_CREDENTIAL === "project"
      ? { ZITADEL_PREVIEW_TOKEN: "pt" }
      : { ZITADEL_PROJECT_SECRET: "sk" }),
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

        expect(result).toFailWith("E_NOT_FOUND");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_NOT_FOUND",
          message: expect.stringContaining("is this a Zitadel platform API?"),
          details: {
            status: 404,
            url: expect.stringMatching(/\/projects\/\S+$/),
            body: { raw: "<html>not here</html>" },
          },
        });
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toFailWith("E_NETWORK");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: expect.stringMatching(/\/projects\/\S+$/),
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope", async () => {
        const app = await anAppAdmittingPreviews();
        const waiting = platform.hangs();

        const result = app.run(["preview", "--origin", PREVIEW_URL, "--json"]);
        await waiting;
        pressCtrlC();

        const finished = await result;
        expect(finished).toFailWith("E_CANCELLED");
        expect(finished.exitCode).toBe(130);
        expect(app.envelopeOf(finished)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await anAppAdmittingPreviews();
      const args = ["preview", "--origin", PREVIEW_URL];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("deploys to the preview URL it is given", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", "1d", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("deploys to every URL it is given", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--origin",
          PREVIEW_URL,
          "--origin",
          OTHER_URL,
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 2 URLs$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
              { url: OTHER_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("pins the release it built for the build to read", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const { data } = app.envelopeOf<{ content_hash: string; release_env: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: `Previewed ${data.content_hash} on 1 URL`,
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: `NEXT_PUBLIC_ZITADEL_RELEASE=${data.content_hash}`,
          },
          warnings: [],
        });
      });

      it("records -m on the release and the deployment", async () => {
        const app = await anAppAdmittingPreviews();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });

        const result = await app.run([
          "preview",
          "--origin",
          PREVIEW_URL,
          "-m",
          "add company",
          "--json",
        ]);

        const { data } = app.envelopeOf<{ release_id: string; deployment_id: string }>(result);
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
        expect(await app.releaseMessage(data.release_id)).toBe("add company");
        expect(await app.deploymentMessage(data.deployment_id)).toBe("add company");
      });

      it("records the commit subject when -m is omitted", async () => {
        const app = await anAppAdmittingPreviews();
        await app.editUserSchema((schema) => {
          schema.properties.company = { type: "string" };
        });
        await app.commit();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const { data } = app.envelopeOf<{ release_id: string; deployment_id: string }>(result);
        expect(await app.releaseMessage(data.release_id)).toBe("wip");
        expect(await app.deploymentMessage(data.deployment_id)).toBe("wip");
      });

      it.each(["30s", "366d"])("refuses a ttl of %s, outside the 60s..365d range", async (ttl) => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--ttl", ttl, "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: `${ttl} is outside the allowed range`,
          hint: "A preview lives between 60s and 365d.",
        });
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

        const { data } = app.envelopeOf<{ previews: { expires_at: string }[] }>(result);
        expect(Date.parse(data.previews[0]?.expires_at ?? "") - Date.now()).toBeLessThan(
          2 * 60 * 60 * 1000,
        );
      });

      it("gives the preview an expiry when --ttl is omitted", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("deploys when the preview token may not read the project", async () => {
        const app = await anAppAdmittingPreviews();
        platform.refusesProjectReads();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toSucceed();
        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      // A refusal of permission is tolerated above, because the server decides
      // what the preview token may deploy to. A credential the server does not
      // accept at all is a different answer and must not be read as one.
      it("fails when the preview token is not accepted at all", async () => {
        const app = await anAppAdmittingPreviews();
        platform.rejectsTheCredential();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        expect(result).toFailWith("E_AUTH");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_AUTH",
          message: "the credential was not accepted",
          details: {
            status: 401,
            url: expect.stringMatching(/\/projects\/\S+$/),
            body: { code: "auth.unauthorized", message: "the credential was not accepted" },
          },
        });
      });

      it("answers a dry run with what it validated and the command to run for real", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--dry-run", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: "Validated the preview for 1 URL and deployed nothing (dry run)",
            dry_run: true,
            targets: [PREVIEW_URL],
            next_commands: [
              expectedPublicCliCommand(app.againAsRun(`preview --origin ${PREVIEW_URL}`)),
            ],
          },
          warnings: [],
        });
      });

      it("keeps every flag it was typed with in the command a dry run suggests", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--origin",
          PREVIEW_URL,
          "--origin",
          OTHER_URL,
          "--ttl",
          "1d",
          "-m",
          "add company",
          "--strict",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: "Validated the preview for 2 URLs and deployed nothing (dry run)",
            dry_run: true,
            targets: [PREVIEW_URL, OTHER_URL],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun(
                  `preview --origin ${PREVIEW_URL} --origin ${OTHER_URL} --ttl 1d --message 'add company' --strict`,
                ),
              ),
            ],
          },
          warnings: [],
        });
      });

      it("carries a URL holding a control character raw in a dry run and spells it out in the command", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--origin",
          "https://w\u001b[2J-acme.vercel.app",
          "--dry-run",
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: "Validated the preview for 1 URL and deployed nothing (dry run)",
            dry_run: true,
            targets: ["https://w\u001b[2J-acme.vercel.app"],
            next_commands: [
              expectedPublicCliCommand(
                app.againAsRun("preview --origin $'https://w\\x1b[2J-acme.vercel.app'"),
              ),
            ],
          },
          warnings: [],
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("treats a trailing slash on --origin as the same preview URL", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--origin", `${PREVIEW_URL}/`, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items.map((preview) => preview.origin)).toEqual([
          PREVIEW_URL,
        ]);
      });

      it("skips a CI build that names no environment, warning once", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], {
          CI: "true",
        });

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          reason: "nothing-to-preview",
          data: { title: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build" },
          warnings: [UNNAMED_CI_WARNING],
        });
      });

      it.each([
        ["Jenkins", { JENKINS_URL: "https://ci.example" }],
        ["Cloudflare Pages", { CF_PAGES: "1" }],
        ["Azure Pipelines", { TF_BUILD: "True" }],
        ["AWS CodeBuild", { CODEBUILD_BUILD_ID: "build:1" }],
      ])("skips a %s build that names no environment", async (_, env) => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], env);

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          reason: "nothing-to-preview",
          data: { title: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build" },
          warnings: [UNNAMED_CI_WARNING],
        });
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
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message:
            'Configuration validation failed (1 issue):\n  - .zitadel/idps/google.json: client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
          hint: `Publish a secret with ${expectedPublicCliCommand(app.againAsRun("variable set NAME --secret"))} and reference it as "\${{ NAME }}".`,
          details: {
            issues: [
              {
                message:
                  'client_secret must reference a variable, not hold a value. Use "client_secret": "${{ NAME }}" and publish the value as that variable.',
                path: ".zitadel/idps/google.json",
                rule: "connection/literal-secret",
              },
            ],
          },
        });
      });

      it("deploys in a CI build that names the preview environment", async () => {
        const app = await anAppAdmittingPreviews();
        await app.bindEnvironment("preview", await app.developmentValues());

        const result = await app.run(
          ["preview", "--env", "preview", "--origin", PREVIEW_URL, "--json"],
          { CI: "true" },
        );

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("deploys in a CI build whose ZITADEL_ENV names the preview environment", async () => {
        const app = await anAppAdmittingPreviews();
        await app.bindEnvironment("preview", await app.developmentValues());

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"], {
          CI: "true",
          ZITADEL_ENV: "preview",
        });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("refuses the primary origins as a target, without sending the build on to a deploy", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--origin", "primary", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "A preview cannot target the primary origins",
          hint: "Pass the preview URLs with --origin; production is deployed after merge.",
        });
      });

      it("deploys to the URL the hosting platform announces when no --origin is given", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--json"], { VERCEL_URL: "x-acme.vercel.app" });

        expect(app.envelopeOf(result)).toEqual({
          status: "ok",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          data: {
            title: expect.stringMatching(/^Previewed sha256:[0-9a-f]{64} on 1 URL$/),
            release_id: expect.stringMatching(/^rel_/),
            content_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
            deployment_id: expect.stringMatching(/^dep_/),
            previews: [
              { url: PREVIEW_URL, expires_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) },
            ],
            release_env: expect.stringMatching(/^NEXT_PUBLIC_ZITADEL_RELEASE=sha256:[0-9a-f]{64}$/),
          },
          warnings: [],
        });
      });

      it("refuses a primary origin's own URL as a target", async () => {
        const app = await aSetUpApp();
        await app.addPrimaryOrigin("https://app.acme.com");

        const result = await app.run(["preview", "--origin", "https://app.acme.com", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "https://app.acme.com is a primary origin",
          hint: "Pass the preview URLs with --origin; production is deployed after merge.",
        });
      });

      it("refuses a ttl outside the range even where it would skip", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--env", "production", "--ttl", "400d", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "400d is outside the allowed range",
          hint: "A preview lives between 60s and 365d.",
        });
      });

      it("fails when no preview URL is given or detected", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: "No preview URLs to deploy to",
          hint: "Pass --origin, or run inside a pull-request build that sets one of: VERCEL_BRANCH_URL, VERCEL_URL, DEPLOY_PRIME_URL, DEPLOY_URL.",
        });
      });

      it("says there is nothing to preview in production without an origin", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["preview", "--env", "production", "--json"]);

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          reason: "nothing-to-preview",
          data: { title: "nothing to preview — production is deployed after merge" },
        });
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

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          reason: "nothing-to-preview",
          data: { title: "nothing to preview — production is deployed after merge" },
        });
      });

      it("registers no preview in production even with an origin", async () => {
        const app = await anAppAdmittingPreviews();

        await app.run(["preview", "--env", "production", "--origin", PREVIEW_URL, "--json"]);

        const listed = await app.run(["preview", "list", "--json"]);
        expect(app.envelopeOf<Listed>(listed).data.items).toEqual([]);
      });

      it("skips when the preview credential is not set, warning once and naming it", async () => {
        const app = await anAppWithoutAPreviewCredential();

        const result = await app.run([
          "preview",
          "--env",
          "preview",
          "--origin",
          PREVIEW_URL,
          "--json",
        ]);

        expect(app.envelopeOf(result)).toEqual({
          status: "skipped",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          reason: "no-preview-credential",
          data: { title: "no preview credential (ZITADEL_PROJECT_SECRET) — preview skipped" },
          warnings: [
            `No preview credential (${CREDENTIALS[PREVIEW_CREDENTIAL]}) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.`,
          ],
        });
      });

      it("fails naming the preview credential under --strict when it is not set", async () => {
        const app = await anAppWithoutAPreviewCredential();

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
        expect(app.envelopeOf(result)).toEqual({
          status: "error",
          cli_version: expect.any(String),
          command: "preview",
          source: "http://mock.zitadel.test",
          code: "E_VALIDATION",
          message: `${CREDENTIALS[PREVIEW_CREDENTIAL]} is not set`,
          hint: `Set ${CREDENTIALS[PREVIEW_CREDENTIAL]} for this build, or drop --strict to skip the preview when it is absent.`,
        });
      });

      it("never carries a credential", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--json"]);

        const values = await app.developmentValues();
        for (const [name, value] of Object.entries(values)) {
          if (/SECRET|TOKEN/.test(name)) {
            expect(result.stdout + result.stderr).not.toContain(value);
          }
        }
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

      it("draws the headline the envelope carries, with each URL it deployed to", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--origin", OTHER_URL]);

        const lines = result.stdout.trimEnd().split("\n");
        expect(lines[0]).toMatch(/^Previewed sha256:[0-9a-f]{64} on 2 URLs$/);
        expect(lines[1]).toMatch(new RegExp(`^ {2}- ${PREVIEW_URL} \\(until \\S+\\)$`));
        expect(lines[2]).toMatch(new RegExp(`^ {2}- ${OTHER_URL} \\(until \\S+\\)$`));
      });

      it("prints the headline once", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL]);

        expect(result.stdout.match(/Previewed sha256:/g)).toHaveLength(1);
      });

      it("draws a dry run's headline and the URLs it validated", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--dry-run"]);

        const lines = result.stdout.split("\n");
        expect(lines[0]).toBe("Validated the preview for 1 URL and deployed nothing (dry run)");
        expect(lines[1]).toBe(`  - ${PREVIEW_URL}`);
      });

      it("suggests the real command once after a dry run", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL, "--dry-run"]);

        expect(result).toSayOnce(
          expectedPublicCliCommand(app.againAsRun(`preview --origin ${PREVIEW_URL}`)),
        );
      });

      it("spells out a control character in the URL a dry run validated", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run([
          "preview",
          "--origin",
          "https://w\u001b[2J-acme.vercel.app",
          "--dry-run",
        ]);

        expect(result.stdout.split("\n")[1]).toBe("  - https://w\\x1b[2J-acme.vercel.app");
        expect(result.stdout + result.stderr).not.toContain("\u001b");
      });

      it("draws the headline of a skipped production build", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--env", "production", "--origin", PREVIEW_URL]);

        expect(result.stdout).toBe("nothing to preview — production is deployed after merge\n");
      });

      it("draws the headline of a skipped CI build, and warns once on stderr", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL], { CI: "true" });

        expect(result.stdout).toBe(
          "nothing to preview — set ZITADEL_ENV=preview in the pull-request build\n",
        );
        expect(result.stderr.split(UNNAMED_CI_WARNING)).toHaveLength(2);
      });

      it("draws the headline of a build without the preview credential, and warns once", async () => {
        const app = await anAppWithoutAPreviewCredential();

        const result = await app.run(["preview", "--env", "preview", "--origin", PREVIEW_URL]);

        expect(result.stdout).toBe(
          `no preview credential (${CREDENTIALS[PREVIEW_CREDENTIAL]}) — preview skipped\n`,
        );
        expect(result.stderr.split("is set, so the preview is skipped")).toHaveLength(2);
      });

      it("says how to deploy from a CI build that names no environment", async () => {
        const app = await anAppAdmittingPreviews();

        const result = await app.run(["preview", "--origin", PREVIEW_URL], { CI: "true" });

        expect(result).toSay("Set ZITADEL_ENV=preview in the pull-request build");
      });
    });
  });
});
