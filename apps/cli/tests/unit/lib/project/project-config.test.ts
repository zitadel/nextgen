import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Project, ProjectConfigMissingError } from "@/lib/project";
import { scratchDir } from "@tests/fixtures/scratch";

async function makeTempDir(): Promise<string> {
  return scratchDir("zitadel-shared-test-");
}

describe("Project.hasConfig", () => {
  it("is true when zitadel.json exists, false otherwise", async () => {
    const cwd = await makeTempDir();
    expect(await Project.at(cwd).hasConfig()).toBe(false);
    await writeFile(join(cwd, "zitadel.json"), "{}");
    expect(await Project.at(cwd).hasConfig()).toBe(true);
  });
});

describe("Project.config", () => {
  it("round-trips a real zitadel.json file", async () => {
    const cwd = await makeTempDir();
    const config = { framework: "next", project_id: "proj-001" };
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify(config));

    expect((await Project.at(cwd).config()).data).toEqual(config);
  });

  it("throws an actionable E_VALIDATION error when the file is missing", async () => {
    const cwd = await makeTempDir();
    try {
      await Project.at(cwd).config();
      expect.unreachable("expected ProjectConfig.read to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectConfigMissingError);
      expect(error).toMatchObject({
        code: "E_VALIDATION",
      });
      expect(error).toHaveProperty(
        "message",
        expect.stringContaining("zitadel.json was not found"),
      );
    }
  });

  it("propagates malformed-JSON errors unchanged (not wrapped as not-found)", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), "{ not valid json");

    await expect(Project.at(cwd).config()).rejects.toThrow();
    await expect(Project.at(cwd).config()).rejects.not.toBeInstanceOf(ProjectConfigMissingError);
  });

  it("rejects a non-object JSON root via parseJsonObject", async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify([1, 2, 3]));

    await expect(Project.at(cwd).config()).rejects.toThrow("must contain a JSON object");
  });
});

describe("ProjectConfig", () => {
  /** The configuration a `zitadel.json` of `data` reads as. */
  async function configOf(data: Record<string, unknown>) {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify(data));
    return Project.at(cwd).config();
  }

  it("names the framework setup recorded, or none", async () => {
    expect((await configOf({ framework: { id: "next" } })).frameworkId).toBe("next");
    expect((await configOf({ framework: "next" })).frameworkId).toBeUndefined();
    expect((await configOf({})).frameworkId).toBeUndefined();
  });

  it.each([
    [{}, "react"],
    [{ branding: { renderer: "default" } }, "react"],
    [{ branding: { renderer: "vue" } }, "vue"],
  ])("reads the renderer of %j as %s", async (data, expected) => {
    expect((await configOf(data)).rendererId).toBe(expected);
  });

  it("reads the preset and the use case when they are strings", async () => {
    const config = await configOf({ preset: "passwordless", useCase: "b2b" });
    const bare = await configOf({});

    expect([config.preset, config.useCase]).toEqual(["passwordless", "b2b"]);
    expect([bare.preset, bare.useCase]).toEqual([undefined, undefined]);
  });

  it("reads the server it lives on, else nothing", async () => {
    expect((await configOf({ server: "http://localhost:8080" })).server).toBe(
      "http://localhost:8080",
    );
    expect((await configOf({})).server).toBeUndefined();
  });

  it("answers as an empty configuration when there is none to read", async () => {
    const config = await Project.at(await makeTempDir()).configOrEmpty();

    expect(config.data).toEqual({});
  });
});
