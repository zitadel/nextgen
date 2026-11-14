import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";
import { cliVersion, expectedPublicCliCommand, pressCtrlC } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";
import { PRIMARY_ORIGIN } from "@tests/helpers/records";

const platform = usePlatformMock();

interface Resolution {
  readonly values: Array<{ variable: string; value: string }>;
}

const ADD = ["env", "add", "production", "--non-interactive", "--json"];

const PROJECT_ID = /^proj-[0-9a-f]+$/;

/** The project id `env` reports for an environment, once it has been added. */
async function projectOf(app: ScaffoldedApp, name: string): Promise<string | undefined> {
  const result = await app.run(["env", "--env", name, "--json"]);
  return app
    .envelopeOf<Resolution>(result)
    .data.values.find((entry) => entry.variable === "ZITADEL_PROJECT_ID")?.value;
}

/** The names `env list` reports as bound. */
async function boundEnvironments(app: ScaffoldedApp): Promise<string[]> {
  const result = await app.run(["env", "list", "--json"]);
  return app
    .envelopeOf<{ items: Array<{ name: string }> }>(result)
    .data.items.map((entry) => entry.name);
}

describe("env add", () => {
  describe("against an invalid server", () => {
    describe("that is not a zitadel api", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_NOT_FOUND");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_NOT_FOUND",
          message: expect.stringMatching(
            /^POST http:\/\/mock\.zitadel\.test\/api\/v1\/projects returned 404 — .* is this a Zitadel platform API\?$/,
          ),
          details: {
            status: 404,
            url: "http://mock.zitadel.test/api/v1/projects",
            body: { raw: "<html>not here</html>" },
          },
        });
      });

      it("writes nothing", async () => {
        const app = await aSetUpApp();
        platform.isNotZitadel();

        await app.run(ADD);

        expect(await app.hasProjectFile(".env.production.local")).toBe(false);
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_NETWORK",
          message: "down",
          details: {
            status: 503,
            url: "http://mock.zitadel.test/api/v1/projects",
            body: { code: "unavailable", message: "down" },
          },
        });
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_NETWORK");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_NETWORK",
          message: "POST http://mock.zitadel.test/api/v1/projects got no response",
          hint: "Check your connection and the server URL (ZITADEL_URL or --server).",
          details: {
            url: "http://mock.zitadel.test/api/v1/projects",
            reason: "unreachable",
          },
        });
      });
    });

    describe("that hangs", () => {
      it("stops on Ctrl-C with one envelope and exit 130", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(ADD);
        await waiting;
        pressCtrlC();

        const cancelled = await result;
        expect(cancelled).toExitWith(130);
        expect(JSON.parse(cancelled.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_CANCELLED",
          message: "Cancelled",
          hint: "The command was cancelled with Ctrl-C.",
        });
      });

      it("writes nothing", async () => {
        const app = await aSetUpApp();
        const waiting = platform.hangs();

        const result = app.run(ADD);
        await waiting;
        pressCtrlC();
        await result;

        expect(await app.hasProjectFile(".env.production.local")).toBe(false);
      });
    });
  });

  describe("against a valid server", () => {
    it("holds its invariants in every rendering", async () => {
      const app = await aSetUpApp();
      platform.servesAHostileOrigin();
      const args = ["env", "add", "staging"];

      await app.inEveryRendering((how) => app.run(how.json ? [...args, "--json"] : args, how.env));
    });

    describe("--json", () => {
      it("binds the environment to a project it creates", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        const projectId = JSON.parse(added.stdout).data.project_id;
        expect(projectId).toMatch(PROJECT_ID);
        expect(JSON.parse(added.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          data: {
            title: `Added the production environment, bound to ${projectId}`,
            environment: "production",
            file: ".env.production.local",
            server: "http://mock.zitadel.test",
            project_id: projectId,
            keys: [
              "ZITADEL_URL",
              "ZITADEL_PROJECT_ID",
              "ZITADEL_PROJECT_SECRET",
              "ZITADEL_PREVIEW_TOKEN",
              "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
            ],
            platform: {
              production: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
                { name: "ZITADEL_ENV", value: "production" },
                { name: "ZITADEL_ENVIRONMENT", value: "production" },
                { name: "ZITADEL_ISSUER", value: "<the URL your production app is served from>" },
              ],
              preview: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_ENV", value: "preview" },
                { name: "ZITADEL_ENVIRONMENT", value: "preview" },
                { name: "ZITADEL_PREVIEW_TOKEN", secret: true },
              ],
              pipeline: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
              ],
            },
            deployment: null,
            next_commands: [
              expectedPublicCliCommand(
                `env --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("registers the app url as an origin, and offers a deploy to the environment it added", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--app-url", "https://app.example.com"]);

        const projectId = JSON.parse(added.stdout).data.project_id;
        expect(JSON.parse(added.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          data: {
            title: `Added the production environment, bound to ${projectId}`,
            environment: "production",
            file: ".env.production.local",
            server: "http://mock.zitadel.test",
            project_id: projectId,
            keys: [
              "ZITADEL_URL",
              "ZITADEL_PROJECT_ID",
              "ZITADEL_PROJECT_SECRET",
              "ZITADEL_PREVIEW_TOKEN",
              "ZITADEL_ISSUER",
              "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
            ],
            platform: {
              production: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
                { name: "ZITADEL_ENV", value: "production" },
                { name: "ZITADEL_ENVIRONMENT", value: "production" },
                { name: "ZITADEL_ISSUER", value: "https://app.example.com" },
              ],
              preview: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_ENV", value: "preview" },
                { name: "ZITADEL_ENVIRONMENT", value: "preview" },
                { name: "ZITADEL_PREVIEW_TOKEN", secret: true },
              ],
              pipeline: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: projectId },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
              ],
            },
            deployment: null,
            next_commands: [
              expectedPublicCliCommand(
                `deploy --message '<what changed>' --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
              ),
              expectedPublicCliCommand(
                `env --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("binds a project that already exists, with no secret to write", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--project", "proj_existing"]);

        expect(JSON.parse(added.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          data: {
            title: "Added the production environment, bound to proj_existing",
            environment: "production",
            file: ".env.production.local",
            server: "http://mock.zitadel.test",
            project_id: "proj_existing",
            keys: ["ZITADEL_URL", "ZITADEL_PROJECT_ID", "NEXT_PUBLIC_ZITADEL_PROJECT_ID"],
            platform: {
              production: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: "proj_existing" },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: "proj_existing" },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
                { name: "ZITADEL_ENV", value: "production" },
                { name: "ZITADEL_ENVIRONMENT", value: "production" },
                { name: "ZITADEL_ISSUER", value: "<the URL your production app is served from>" },
              ],
              preview: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: "proj_existing" },
                { name: "NEXT_PUBLIC_ZITADEL_PROJECT_ID", value: "proj_existing" },
                { name: "ZITADEL_ENV", value: "preview" },
                { name: "ZITADEL_ENVIRONMENT", value: "preview" },
                { name: "ZITADEL_PREVIEW_TOKEN", secret: true },
              ],
              pipeline: [
                { name: "ZITADEL_URL", value: "http://mock.zitadel.test" },
                { name: "ZITADEL_PROJECT_ID", value: "proj_existing" },
                { name: "ZITADEL_PROJECT_SECRET", secret: true },
              ],
            },
            deployment: null,
            next_commands: [
              expectedPublicCliCommand(
                `env --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("suggests allowing the app url as an origin of a bound project whose secret it holds", async () => {
        const app = await aSetUpApp();

        const added = await app.run(
          [...ADD, "--project", "proj_existing", "--app-url", "https://app.example.com"],
          {
            ZITADEL_PROJECT_SECRET: "sk_bound_secret",
            ZITADEL_PREVIEW_TOKEN: "pk_bound_token",
          },
        );

        const { data } = JSON.parse(added.stdout);
        expect(data.keys).toEqual([
          "ZITADEL_URL",
          "ZITADEL_PROJECT_ID",
          "ZITADEL_PROJECT_SECRET",
          "ZITADEL_PREVIEW_TOKEN",
          "ZITADEL_ISSUER",
          "NEXT_PUBLIC_ZITADEL_PROJECT_ID",
        ]);
        expect(data.next_commands).toEqual([
          expectedPublicCliCommand(
            `origin add https://app.example.com --kind primary --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
          ),
          expectedPublicCliCommand(
            `env --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
          ),
        ]);
      });

      it("never carries a secret it was handed for a bound project", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--project", "proj_existing"], {
          ZITADEL_PROJECT_SECRET: "sk_bound_secret",
          ZITADEL_PREVIEW_TOKEN: "pk_bound_token",
        });

        expect(added).toSucceed();
        expect(added.stdout + added.stderr).not.toContain("sk_bound_secret");
        expect(added.stdout + added.stderr).not.toContain("pk_bound_token");
      });

      it("creates a project of its own, not the development one", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        expect(await projectOf(app, "development")).not.toBe(
          app.envelopeOf<{ project_id: string }>(added).data.project_id,
        );
      });

      it("binds the environment to the project it created", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        expect(await projectOf(app, "production")).toBe(
          app.envelopeOf<{ project_id: string }>(added).data.project_id,
        );
      });

      it("binds a project that already exists", async () => {
        const app = await aSetUpApp();

        await app.run([...ADD, "--project", "proj_existing"]);

        expect(await projectOf(app, "production")).toBe("proj_existing");
      });

      it("refuses to overwrite an environment that is already bound", async () => {
        const app = await aSetUpApp();
        expect(await app.run(ADD)).toSucceed();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_CONFLICT");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_CONFLICT",
          message: ".env.production.local already exists",
          hint: "Pass --force to overwrite it.",
        });
      });

      it("overwrites with --force, binding a project of its own", async () => {
        const app = await aSetUpApp();
        const first = await app.run(ADD);

        const result = await app.run([...ADD, "--force"]);

        expect(result).toSucceed();
        expect(await projectOf(app, "production")).toBe(
          app.envelopeOf<{ project_id: string }>(result).data.project_id,
        );
        expect(await projectOf(app, "production")).not.toBe(
          app.envelopeOf<{ project_id: string }>(first).data.project_id,
        );
      });

      it("refuses a name that cannot name a file", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "a..b", "--non-interactive", "--json"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_VALIDATION",
          message: '"a..b" is not a usable environment name',
          hint: 'Use letters, digits, dot, dash and underscore, and no "..", e.g. production.',
        });
      });

      it("refuses an app url that is not an http(s) one", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--app-url", "ftp://x"]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_VALIDATION",
          message: 'Invalid app URL "ftp://x"',
          hint: `Use a URL like ${PRIMARY_ORIGIN}.`,
        });
      });

      it("registers the app url as a primary origin on the project it creates", async () => {
        const app = await aSetUpApp();
        await app.run([...ADD, "--app-url", "https://app.example.com"]);

        const listed = await app.run(["origin", "list", "--env", "production", "--json"]);

        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toContainEqual({
          pattern: "https://app.example.com",
          kind: "primary",
        });
      });

      it("deploys nothing to the environment it adds when nobody can be asked", async () => {
        const app = await aSetUpApp();
        await app.run(ADD);

        const listed = await app.run(["deployment", "list", "--env", "production", "--json"]);

        expect(app.envelopeOf<{ items: unknown[] }>(listed).data.items).toEqual([]);
      });

      it("offers no deploy to an environment with no origin for one to land on", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        expect(added).not.toSuggest("deploy");
      });

      it("refuses to guess a server when it cannot ask, keeping every flag that was typed", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer([
          ...ADD,
          "--project",
          "proj_x",
          "--app-url",
          "https://app.example.com",
          "--force",
        ]);

        expect(result).toFailWith("E_VALIDATION");
        expect(JSON.parse(result.stdout)).toEqual({
          status: "error",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          code: "E_VALIDATION",
          message: "No server supplied",
          hint: `Pass --server. For example: ${expectedPublicCliCommand(`env add production --server https://api.zitadel.cloud --project proj_x --app-url https://app.example.com --force --cwd ${app.path}`)}`,
          next_commands: [
            expectedPublicCliCommand(
              `env add production --server https://api.zitadel.cloud --project proj_x --app-url https://app.example.com --force --cwd ${app.path}`,
            ),
          ],
        });
      });

      it("carries a project id the server answered as it was answered, and no secret", async () => {
        const app = await aSetUpApp();
        const hostile = platform.mintsAHostileProjectId();

        const added = await app.run(ADD);

        expect(JSON.parse(added.stdout).data.project_id).toBe(hostile);
        expect(JSON.parse(added.stdout).data.title).toBe(
          `Added the production environment, bound to ${hostile}`,
        );
        expect(added.stdout + added.stderr).not.toContain("sk_proj_hostile");
        expect(added.stdout + added.stderr).not.toContain("pk_proj_hostile");
      });
    });

    describe("a dry run", () => {
      it("says what it would add, naming a new project, and suggests the real command", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          data: {
            title: "Would add the production environment, bound to a new project (dry run)",
            dry_run: true,
            environment: "production",
            file: ".env.production.local",
            server: "http://mock.zitadel.test",
            next_commands: [
              expectedPublicCliCommand(
                `env add production --server http://mock.zitadel.test --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("keeps every flag that was typed in the real command", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          ...ADD,
          "--dry-run",
          "--project",
          "proj_x",
          "--app-url",
          "https://a.example.com",
          "--force",
        ]);

        expect(JSON.parse(result.stdout)).toEqual({
          status: "ok",
          cli_version: cliVersion.version,
          command: "env:add",
          source: "",
          data: {
            title: "Would add the production environment, bound to proj_x (dry run)",
            dry_run: true,
            environment: "production",
            file: ".env.production.local",
            server: "http://mock.zitadel.test",
            project_id: "proj_x",
            issuer: "https://a.example.com",
            next_commands: [
              expectedPublicCliCommand(
                `env add production --server http://mock.zitadel.test --project proj_x --app-url https://a.example.com --force --cwd ${app.path}`,
              ),
            ],
          },
          warnings: [],
        });
      });

      it("writes nothing", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(result).toSucceed();
        expect(await boundEnvironments(app)).toEqual(["development"]);
      });

      it("still refuses an environment that is already bound", async () => {
        const app = await aSetUpApp();
        expect(await app.run(ADD)).toSucceed();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(result).toFailWith("E_CONFLICT");
      });

      it("draws the headline the envelope carries", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive", "--dry-run"]),
        );

        expect(result).toPrint(
          "Would add the production environment, bound to a new project (dry run)",
        );
      });

      it("names what it would create and write", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive", "--dry-run"]),
        );

        expect(result).toPrint("Would create a project on http://mock.zitadel.test");
        expect(result).toPrint("Would write .env.production.local");
      });

      it("names the existing project it would bind", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run([
            "env",
            "add",
            "production",
            "--non-interactive",
            "--dry-run",
            "--project",
            "proj_x",
          ]),
        );

        expect(result).toPrint("Would bind the existing project proj_x");
      });
    });

    describe("rendered for a terminal", () => {
      it("draws the headline naming the project it bound", async () => {
        const app = await aSetUpApp();
        platform.mintsAHostileProjectId();

        const result = await asTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive"]),
        );

        expect(result).toPrint("Added the production environment, bound to proj-\\x1b[2Jwiped");
      });

      it("names the file it wrote and the keys it holds", async () => {
        const app = await aSetUpApp();

        const result = await asTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive"]),
        );

        expect(result).toPrint(
          ".env.production.local holds ZITADEL_URL, ZITADEL_PROJECT_ID, ZITADEL_PROJECT_SECRET, ZITADEL_PREVIEW_TOKEN, NEXT_PUBLIC_ZITADEL_PROJECT_ID.",
        );
      });

      it("names the variables for the production scope", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result).toPrint("Hosting platform, production scope:");
      });

      it("names the pipeline's variables", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result).toPrint("Pipeline secret store");
      });

      it("says the environment refuses sign-in until it is deployed to", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result).toPrint("Nothing is deployed to production yet");
      });

      it("tells the caller to give the environment an origin, then deploy, with the file it wrote", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result).toPrint(
          `Give it an origin first: ${expectedPublicCliCommand(`origin add '<your-app-url>' --kind primary --env-file ${app.path}/.env.production.local --cwd ${app.path}`)}`,
        );
        expect(result).toPrint(
          `Then deploy to it: ${expectedPublicCliCommand(`deploy --message '<what changed>' --env-file ${app.path}/.env.production.local --cwd ${app.path}`)}`,
        );
      });

      it("tells the caller to deploy to the environment it added, once", async () => {
        const app = await aSetUpApp();

        const added = await app.run([
          "env",
          "add",
          "production",
          "--non-interactive",
          "--app-url",
          "https://app.example.com",
        ]);

        expect(added).toSayOnce(
          expectedPublicCliCommand(
            `deploy --message '<what changed>' --env-file ${app.path}/.env.production.local --cwd ${app.path}`,
          ),
        );
      });

      it("spells out an escape sequence the server put in the project id", async () => {
        const app = await aSetUpApp();
        platform.mintsAHostileProjectId();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });

      it("never prints a secret", async () => {
        const app = await aSetUpApp();
        platform.mintsAHostileProjectId();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result.stdout + result.stderr).not.toContain("sk_proj_hostile");
        expect(result.stdout + result.stderr).not.toContain("pk_proj_hostile");
      });

      it("says what a dry run would have added", async () => {
        const app = await aSetUpApp();

        const result = await app.run([
          "env",
          "add",
          "production",
          "--non-interactive",
          "--dry-run",
        ]);

        expect(result).toPrint("Would add the production environment, bound to a new project");
      });
    });

    describe("piped", () => {
      it("carries the headline and the file it wrote on stdout", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive"]),
        );

        expect(result).toPrint("Wrote .env.production.local");
        expect(result).toPrint("Added the production environment, bound to proj-");
      });

      it("says the file it wrote once", async () => {
        const app = await aSetUpApp();

        const result = await offTerminal(() =>
          app.run(["env", "add", "production", "--non-interactive"]),
        );

        expect(result).toSayOnce("Wrote .env.production.local");
      });
    });
  });
});
