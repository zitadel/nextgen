import { describe, expect, it } from "vitest";

import { usePlatformMock } from "@tests/helpers/platform";
import { aSetUpApp, type ScaffoldedApp } from "@tests/helpers/project";

const platform = usePlatformMock();

interface Added {
  readonly project_id: string;
  readonly platform: Record<"production" | "preview" | "pipeline", Array<{ name: string }>>;
}

interface Resolution {
  readonly values: Array<{ variable: string; value: string }>;
}

const ADD = ["env", "add", "production", "--non-interactive", "--json"];

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
      });
    });

    describe("that is down", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.isUnavailable();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_NETWORK");
      });
    });

    describe("that refuses connections", () => {
      it("fails", async () => {
        const app = await aSetUpApp();
        platform.refusesConnections();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_NETWORK");
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

        expect(added).toSucceed();
        expect(await projectOf(app, "production")).toBe(
          app.envelopeOf<Added>(added).data.project_id,
        );
      });

      it("creates a project of its own, not the development one", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        expect(await projectOf(app, "development")).not.toBe(
          app.envelopeOf<Added>(added).data.project_id,
        );
      });

      it("binds a project that already exists", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--project", "proj_existing"]);

        expect(added).toSucceed();
        expect(await projectOf(app, "production")).toBe("proj_existing");
      });

      it("refuses to overwrite an environment that is already bound", async () => {
        const app = await aSetUpApp();
        expect(await app.run(ADD)).toSucceed();

        const result = await app.run(ADD);

        expect(result).toFailWith("E_CONFLICT");
      });

      it("overwrites with --force", async () => {
        const app = await aSetUpApp();
        expect(await app.run(ADD)).toSucceed();

        const result = await app.run([...ADD, "--force"]);

        expect(result).toSucceed();
      });

      it("names what the hosting platform and the pipeline need", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--app-url", "https://app.example.com"]);

        const { platform: variables } = app.envelopeOf<Added>(added).data;
        expect(variables.production.map((variable) => variable.name)).toContain("ZITADEL_ISSUER");
        expect(variables.preview.map((variable) => variable.name)).toContain(
          "ZITADEL_PREVIEW_TOKEN",
        );
        expect(variables.pipeline.map((variable) => variable.name)).toContain(
          "ZITADEL_PROJECT_SECRET",
        );
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

      it("tells the caller to deploy to the environment it added", async () => {
        const app = await aSetUpApp();

        const added = await app.run([...ADD, "--app-url", "https://app.example.com"]);

        expect(added).toSuggest(
          `deploy -m '<what changed>' --env-file ${app.path}/.env.production.local`,
        );
      });

      it("offers no deploy to an environment with no origin for one to land on", async () => {
        const app = await aSetUpApp();

        const added = await app.run(ADD);

        expect(added).not.toSuggest(
          `deploy -m '<what changed>' --env-file ${app.path}/.env.production.local`,
        );
      });

      it("writes nothing on a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(result).toSucceed();
        expect(await boundEnvironments(app)).toEqual(["development"]);
      });

      it("says on a dry run what it would add, as the headline it draws", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(app.envelopeOf(result).data).toMatchObject({
          title: "Would add the production environment, bound to a new project (dry run)",
        });
      });

      it("suggests the real command on a dry run", async () => {
        const app = await aSetUpApp();

        const result = await app.run([...ADD, "--dry-run"]);

        expect(result).toSuggest("env add production");
      });

      it("refuses to guess a server when it cannot ask", async () => {
        const app = await aSetUpApp();

        const result = await app.runWithoutServer(ADD);

        expect(result).toFailWith("E_VALIDATION");
      });
    });

    describe("rendered for a terminal", () => {
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

      // The step that names the project it created prints what the server
      // answered, and that never goes through the result envelope, so the
      // escaping has to hold for the narration too.
      it("spells out an escape sequence the server put in the project id", async () => {
        const app = await aSetUpApp();
        platform.mintsAHostileProjectId();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result.stdout + result.stderr).not.toContain("\u001b[2J");
        expect(result.stdout + result.stderr).toContain("\\x1b[2Jwiped");
      });

      it("never prints a secret", async () => {
        const app = await aSetUpApp();

        const result = await app.run(["env", "add", "production", "--non-interactive"]);

        expect(result.stdout).not.toMatch(/sk_proj_/);
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
  });
});
