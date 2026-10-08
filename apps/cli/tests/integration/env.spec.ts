import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { usePlatformMock } from "../helpers/platform";
import { anApp, aSetUpApp } from "../helpers/project";

usePlatformMock();

type Resolved = {
  environment: { value: string; source: string };
  project_id?: { value: string; source: string };
  consulted: Array<{ source: string }>;
};

describe("env", () => {
  it("resolves a set-up project from .zitadel/secret as development", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["env", "--json"]);

    expect(result).toSucceed();
    const { data } = app.envelopeOf<Resolved>(result);
    expect(data.environment).toEqual({ value: "development", source: "default" });
    expect(data.project_id?.source).toBe(".env.development.local");
    expect(data.consulted.map((entry) => entry.source)).toContain(".zitadel/secret");
  });

  it("names the environment a platform build announces", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["env", "--json"], { VERCEL_ENV: "preview" });

    expect(app.envelopeOf<Resolved>(result).data.environment).toEqual({
      value: "preview",
      source: "VERCEL_ENV",
    });
  });

  it("prints what resolved and where it came from for a person", async () => {
    const app = await aSetUpApp();

    const result = await app.run(["env"]);

    expect(result).toPrint("environment  development");
    expect(result).toPrint("consulted, in order:");
  });

  describe("env list", () => {
    it("lists nothing before an environment is bound", async () => {
      const app = await anApp();

      const result = await app.run(["env", "list", "--json"]);

      expect(result).toSucceed();
      expect(app.envelopeOf<{ environments: unknown[] }>(result).data.environments).toEqual([]);
    });
  });

  describe("env add", () => {
    it("binds an existing project by id into .env.<name>.local", async () => {
      const app = await anApp();

      const result = await app.run([
        "env",
        "add",
        "staging",
        "--non-interactive",
        "--json",
        "--project",
        "proj_staging",
      ]);

      expect(result).toSucceed();
      const file = await readFile(join(app.path, ".env.staging.local"), "utf8");
      expect(file).toContain("ZITADEL_PROJECT_ID=proj_staging");
      const listed = app.envelopeOf<{ environments: Array<{ environment: string }> }>(
        await app.run(["env", "list", "--json"]),
      );
      expect(listed.data.environments.map((entry) => entry.environment)).toEqual(["staging"]);
    });

    it("creates a project and writes its credentials", async () => {
      const app = await aSetUpApp();

      const result = await app.run(["env", "add", "production", "--non-interactive", "--json"]);

      expect(result).toSucceed();
      const file = await readFile(join(app.path, ".env.production.local"), "utf8");
      expect(file).toContain("ZITADEL_PROJECT_SECRET=");
      expect(file).toContain("ZITADEL_PREVIEW_TOKEN=");
      // The app's client code reads the id under the framework's public alias.
      const projectId = app.envelopeOf<{ project_id: string }>(result).data.project_id;
      expect(file).toContain(`NEXT_PUBLIC_ZITADEL_PROJECT_ID=${projectId}`);
      const resolved = app.envelopeOf<Resolved>(
        await app.run(["env", "--env", "production", "--json"]),
      );
      expect(resolved.data.environment).toEqual({ value: "production", source: "--env" });
      expect(resolved.data.project_id?.source).toBe(".env.production.local");
    });

    it("allows the origins given on the command line on the project it creates", async () => {
      const app = await anApp();

      const result = await app.run([
        "env",
        "add",
        "production",
        "--non-interactive",
        "--json",
        "--origin",
        "https://app.acme.com",
        "--preview",
        "https://*-acmeinc.vercel.app",
      ]);

      expect(result).toSucceed();
      type Allowed = { pattern: string; kind: string; check: { status: string } };
      const { data } = app.envelopeOf<{ origins: Allowed[]; next_commands: string[] }>(result);
      expect(data.origins.map((entry) => [entry.pattern, entry.kind, entry.check.status])).toEqual([
        ["https://app.acme.com", "primary", "ok"],
        ["https://*-acmeinc.vercel.app", "preview", "ok"],
      ]);
      expect(data.next_commands.some((cmd) => cmd.includes("origin add"))).toBe(false);
      const listed = app.envelopeOf<{ origins: Array<{ pattern: string; kind: string }> }>(
        await app.run(["origin", "list", "--json", "--env", "production"]),
      );
      expect(listed.data.origins).toEqual([
        { pattern: "https://app.acme.com", kind: "primary" },
        { pattern: "https://*-acmeinc.vercel.app", kind: "preview" },
      ]);
    });

    it("steers the resource commands at the bound project", async () => {
      const app = await aSetUpApp();
      expect(
        await app.run(["env", "add", "production", "--non-interactive", "--json"]),
      ).toSucceed();
      const production = app.envelopeOf<Resolved>(
        await app.run(["env", "--env", "production", "--json"]),
      ).data.project_id?.value;
      const development = app.envelopeOf<Resolved>(await app.run(["env", "--json"])).data
        .project_id?.value;
      expect(production).toBeDefined();
      expect(production).not.toBe(development);

      const listed = await app.run(["projects", "get", production!, "--json", "--env", "production"]);

      expect(listed).toSucceed();
      expect(app.envelopeOf<{ id: string }>(listed).data.id).toBe(production);
      expect(await app.run(["users", "list", "--json", "--env", "production"])).toSucceed();
    });

    it("defers the origins when binding an id without a project secret", async () => {
      const app = await anApp();

      const result = await app.run([
        "env",
        "add",
        "staging",
        "--non-interactive",
        "--json",
        "--project",
        "proj_staging",
        "--origin",
        "https://staging.acme.com",
      ]);

      expect(result).toSucceed();
      const { data } = app.envelopeOf<{ origins: unknown[]; next_commands: string[] }>(result);
      expect(data.origins).toEqual([]);
      expect(data.next_commands[0]).toContain("origin add 'https://staging.acme.com' --kind primary");
    });

    it("refuses to overwrite a bound environment without --force", async () => {
      const app = await anApp();
      expect(
        await app.run(["env", "add", "staging", "--non-interactive", "--json", "--project", "p1"]),
      ).toSucceed();

      expect(
        await app.run(["env", "add", "staging", "--non-interactive", "--json", "--project", "p2"]),
      ).toFailWith("E_CONFLICT");
    });
  });
});
