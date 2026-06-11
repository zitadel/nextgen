import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type ReleaseAlphaTrainModule = {
  PUBLIC_PACKAGE_MANIFESTS: string[];
  PUBLIC_PACKAGE_NAMES: string[];
  prepareAlphaReleaseTrain: (options: {
    cwd: string;
    outDir?: string;
    execFile?: (
      command: string,
      args: string[],
      options: { cwd: string },
    ) => Promise<{ stdout: string; stderr: string }>;
  }) => Promise<{
    version: string;
    tagName: string;
    title: string;
    image: string;
    notesPath: string;
  }>;
};

let releaseAlphaTrain: ReleaseAlphaTrainModule;
const tempDirs: string[] = [];

beforeAll(async () => {
  releaseAlphaTrain = (await import(
    new URL("../../../../../scripts/release-alpha-train.mjs", import.meta.url).href
  )) as ReleaseAlphaTrainModule;
});

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("release-alpha-train script", () => {
  it("generates release notes for a lockstep alpha train", async () => {
    const cwd = await fixtureRepo();
    const outDir = join(cwd, "dist/alpha-release");
    const execFile = vi.fn(async () => {
      const error = new Error("missing tag") as Error & { code: number };
      error.code = 1;
      throw error;
    });

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({ cwd, outDir, execFile });

    expect(result.version).toBe("0.1.0-alpha.5");
    expect(result.tagName).toBe("v0.1.0-alpha.5");
    expect(result.title).toBe("ZITADEL Alpha 0.1.0-alpha.5");
    expect(result.image).toBe("ghcr.io/zitadel/nextgen:0.1.0-alpha.5");
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "--verify", "refs/tags/v0.1.0-alpha.5"],
      { cwd },
    );

    const notes = await readFile(result.notesPath, "utf8");
    expect(notes).toContain("npx @zitadel/cli@alpha start");
    expect(notes).toContain("npx @zitadel/cli@0.1.0-alpha.5 start");
    expect(notes).toContain("ghcr.io/zitadel/nextgen:0.1.0-alpha.5");
    expect(notes).toContain("@zitadel/sdk-next");
  });

  it("rejects public package versions that are not lockstep", async () => {
    const cwd = await fixtureRepo({
      versions: { "@zitadel/sdk-next": "0.1.0-alpha.4" },
    });

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: async () => {
          const error = new Error("missing tag") as Error & { code: number };
          error.code = 1;
          throw error;
        },
      }),
    ).rejects.toThrow("public package versions must be lockstep");
  });

  it("rejects a changesets fixed group that is missing or contains extra packages", async () => {
    const cwd = await fixtureRepo({ fixedGroupExtra: ["@zitadel/private-ui"] });

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: async () => {
          const error = new Error("missing tag") as Error & { code: number };
          error.code = 1;
          throw error;
        },
      }),
    ).rejects.toThrow("changesets fixed group must contain exactly the public alpha packages");
  });

  it("rejects an existing Go release tag", async () => {
    const cwd = await fixtureRepo();

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: async () => ({ stdout: "tag", stderr: "" }),
      }),
    ).rejects.toThrow("release tag v0.1.0-alpha.5 already exists");
  });
});

async function fixtureRepo(
  options: {
    versions?: Record<string, string>;
    fixedGroupExtra?: string[];
  } = {},
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-alpha-train-"));
  tempDirs.push(cwd);

  for (let index = 0; index < releaseAlphaTrain.PUBLIC_PACKAGE_MANIFESTS.length; index += 1) {
    const path = releaseAlphaTrain.PUBLIC_PACKAGE_MANIFESTS[index];
    const name = releaseAlphaTrain.PUBLIC_PACKAGE_NAMES[index];
    await mkdir(join(cwd, dirname(path)), { recursive: true });
    await writeFile(
      join(cwd, path),
      `${JSON.stringify(
        {
          name,
          version: options.versions?.[name] ?? "0.1.0-alpha.5",
        },
        null,
        2,
      )}\n`,
    );
  }

  await mkdir(join(cwd, ".changeset"), { recursive: true });
  await writeFile(
    join(cwd, ".changeset/config.json"),
    `${JSON.stringify(
      {
        fixed: [[...releaseAlphaTrain.PUBLIC_PACKAGE_NAMES, ...(options.fixedGroupExtra ?? [])]],
      },
      null,
      2,
    )}\n`,
  );

  return cwd;
}
