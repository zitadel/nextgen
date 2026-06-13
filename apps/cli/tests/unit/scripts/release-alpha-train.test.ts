import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type ReleaseAlphaTrainModule = {
  PUBLIC_PACKAGE_MANIFESTS: string[];
  PUBLIC_PACKAGE_NAMES: string[];
  pruneEmptyChangesets: (options: { cwd: string }) => Promise<string[]>;
  inspectAlphaReleaseTrain: (options: {
    cwd: string;
    execFile?: ExecFileMock;
    published?: boolean | string;
    remote?: boolean | string;
  }) => Promise<{
    shouldComplete: boolean;
    skipReason?: string;
  }>;
  prepareAlphaReleaseTrain: (options: {
    cwd: string;
    outDir?: string;
    execFile?: ExecFileMock;
    published?: boolean | string;
  }) => Promise<{
    version: string;
    tagName: string;
    title: string;
    image: string;
    notesPath: string;
    shouldCreateTag: boolean;
    shouldRunGoreleaser: boolean;
    shouldUpdateRelease: boolean;
  }>;
};
type ExecFileMock = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

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
    const execFile = commandMock();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({ cwd, outDir, execFile });

    expect(result.version).toBe("0.1.0-alpha.5");
    expect(result.tagName).toBe("v0.1.0-alpha.5");
    expect(result.title).toBe("ZITADEL Alpha 0.1.0-alpha.5");
    expect(result.image).toBe("ghcr.io/zitadel/nextgen:0.1.0-alpha.5");
    expect(result.shouldCreateTag).toBe(true);
    expect(result.shouldRunGoreleaser).toBe(true);
    expect(result.shouldUpdateRelease).toBe(true);
    expect(execFile).toHaveBeenCalledWith(
      "git",
      ["rev-list", "-n", "1", "v0.1.0-alpha.5"],
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
        execFile: commandMock(),
      }),
    ).rejects.toThrow("public package versions must be lockstep");
  });

  it("rejects a changesets fixed group that is missing or contains extra packages", async () => {
    const cwd = await fixtureRepo({ fixedGroupExtra: ["@zitadel/private-ui"] });

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
      }),
    ).rejects.toThrow("changesets fixed group must contain exactly the public alpha packages");
  });

  it("reuses an existing Go release tag when it points at the current commit", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({ tagCommit: "head-commit" }),
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(true);
  });

  it("recovers an existing Go release tag when artifacts are missing", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({ tagCommit: "other-commit" }),
      published: true,
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(true);
    expect(result.shouldUpdateRelease).toBe(true);
  });

  it("skips GoReleaser when an existing tag from another commit is already complete", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({
        tagCommit: "other-commit",
        releaseExists: true,
        imageExists: true,
      }),
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(false);
    expect(result.shouldUpdateRelease).toBe(true);
  });

  it("ignores prerelease-tracked and empty changesets when recovering a versioned train", async () => {
    const cwd = await fixtureRepo({
      changesets: {
        "add-spa-sdks.md": releaseChangeset("@zitadel/cli", "minor"),
        "ci-only.md": emptyChangeset(),
      },
      preChangesets: ["add-spa-sdks"],
    });

    await expect(
      releaseAlphaTrain.inspectAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
        remote: false,
      }),
    ).resolves.toMatchObject({
      shouldComplete: true,
      skipReason: "",
    });
  });

  it("blocks unconsumed release changesets before npm publishes", async () => {
    const cwd = await fixtureRepo({
      changesets: {
        "feature.md": releaseChangeset("@zitadel/cli", "minor"),
      },
    });

    await expect(
      releaseAlphaTrain.inspectAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
        remote: false,
      }),
    ).resolves.toMatchObject({
      shouldComplete: false,
      skipReason: "pending changesets: feature.md",
    });
  });

  it("blocks GoReleaser when Changesets did not publish npm packages", async () => {
    const cwd = await fixtureRepo();

    await expect(
      releaseAlphaTrain.inspectAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
        published: false,
        remote: false,
      }),
    ).resolves.toMatchObject({
      shouldComplete: false,
      skipReason: "npm publish did not run",
    });
  });

  it("rejects prepare when Changesets did not publish npm packages", async () => {
    const cwd = await fixtureRepo();

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
        published: false,
      }),
    ).rejects.toThrow("alpha release train is not ready to complete: npm publish did not run");
  });

  it("allows GoReleaser recovery when npm did not publish but the release tag exists", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({ tagCommit: "head-commit" }),
      published: false,
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(true);
    expect(result.shouldUpdateRelease).toBe(true);
  });

  it("allows completion after Changesets publishes npm packages", async () => {
    const cwd = await fixtureRepo();

    await expect(
      releaseAlphaTrain.inspectAlphaReleaseTrain({
        cwd,
        execFile: commandMock(),
        published: true,
        remote: false,
      }),
    ).resolves.toMatchObject({
      shouldComplete: true,
      skipReason: "",
    });
  });

  it("prunes empty changesets before Changesets decides whether to publish", async () => {
    const cwd = await fixtureRepo({
      changesets: {
        "ci-only.md": emptyChangeset(),
        "feature.md": releaseChangeset("@zitadel/cli", "minor"),
      },
    });

    await expect(releaseAlphaTrain.pruneEmptyChangesets({ cwd })).resolves.toEqual([
      "ci-only.md",
    ]);
    await expect(readFile(join(cwd, ".changeset/ci-only.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(join(cwd, ".changeset/feature.md"), "utf8")).resolves.toContain(
      "@zitadel/cli",
    );
  });

  it("skips GoReleaser when both the GitHub Release and container image already exist", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({
        tagCommit: "head-commit",
        releaseExists: true,
        imageExists: true,
      }),
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(false);
    expect(result.shouldUpdateRelease).toBe(true);
  });

  it("runs GoReleaser when the image exists but the GitHub Release is missing", async () => {
    const cwd = await fixtureRepo();

    const result = await releaseAlphaTrain.prepareAlphaReleaseTrain({
      cwd,
      execFile: commandMock({
        tagCommit: "head-commit",
        imageExists: true,
      }),
    });

    expect(result.shouldCreateTag).toBe(false);
    expect(result.shouldRunGoreleaser).toBe(true);
  });

  it("rejects a partial GitHub Release whose container image is missing", async () => {
    const cwd = await fixtureRepo();

    await expect(
      releaseAlphaTrain.prepareAlphaReleaseTrain({
        cwd,
        execFile: commandMock({
          tagCommit: "head-commit",
          releaseExists: true,
        }),
      }),
    ).rejects.toThrow("exists but ghcr.io/zitadel/nextgen:0.1.0-alpha.5 is missing");
  });
});

async function fixtureRepo(
  options: {
    changesets?: Record<string, string>;
    versions?: Record<string, string>;
    fixedGroupExtra?: string[];
    preChangesets?: string[];
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
  if (options.preChangesets) {
    await writeFile(
      join(cwd, ".changeset/pre.json"),
      `${JSON.stringify(
        {
          mode: "pre",
          tag: "alpha",
          initialVersions: {},
          changesets: options.preChangesets,
        },
        null,
        2,
      )}\n`,
    );
  }
  for (const [file, content] of Object.entries(options.changesets ?? {})) {
    await writeFile(join(cwd, ".changeset", file), content);
  }

  return cwd;
}

function releaseChangeset(name: string, type: "major" | "minor" | "patch"): string {
  return ["---", `"${name}": ${type}`, "---", "", "Release package change.", ""].join("\n");
}

function emptyChangeset(): string {
  return ["---", "---", "", "CI-only change.", ""].join("\n");
}

function commandMock(
  options: {
    headCommit?: string;
    imageExists?: boolean;
    releaseExists?: boolean;
    tagCommit?: string;
  } = {},
): ExecFileMock {
  const headCommit = options.headCommit ?? "head-commit";
  return vi.fn(async (command: string, args: string[]) => {
    if (command === "git" && args.join(" ") === "rev-parse HEAD") {
      return { stdout: `${headCommit}\n`, stderr: "" };
    }
    if (command === "git" && args.join(" ") === "rev-list -n 1 v0.1.0-alpha.5") {
      if (options.tagCommit) {
        return { stdout: `${options.tagCommit}\n`, stderr: "" };
      }
      throw missingCommand();
    }
    if (command === "gh" && args[0] === "release" && args[1] === "view") {
      if (options.releaseExists) {
        return { stdout: '{"tagName":"v0.1.0-alpha.5"}\n', stderr: "" };
      }
      throw missingCommand();
    }
    if (command === "docker" && args[0] === "manifest" && args[1] === "inspect") {
      if (options.imageExists) {
        return { stdout: "{}\n", stderr: "" };
      }
      throw missingCommand();
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  });
}

function missingCommand(): Error & { code: number } {
  const error = new Error("missing") as Error & { code: number };
  error.code = 1;
  return error;
}
