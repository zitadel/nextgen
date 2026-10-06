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
    expect(data.project_id?.source).toBe(".env.local");
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
      const app = await anApp();

      const result = await app.run(["env", "add", "production", "--non-interactive", "--json"]);

      expect(result).toSucceed();
      const file = await readFile(join(app.path, ".env.production.local"), "utf8");
      expect(file).toContain("ZITADEL_PROJECT_SECRET=");
      expect(file).toContain("ZITADEL_PREVIEW_TOKEN=");
      const resolved = app.envelopeOf<Resolved>(
        await app.run(["env", "--env", "production", "--json"]),
      );
      expect(resolved.data.environment).toEqual({ value: "production", source: "--env" });
      expect(resolved.data.project_id?.source).toBe(".env.production.local");
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
