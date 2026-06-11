import { describe, expect, it } from "vitest";

type RunCall = {
  command: string;
  args: string[];
  options: { cwd: string; env: Record<string, string | undefined> };
};

type BuildLocalRuntimeImageModule = {
  LOCAL_RUNTIME_IMAGE: string;
  buildLocalRuntimeImage: (options: {
    repoRoot?: string;
    tmpdir?: string;
    nodeArch?: string;
    env?: Record<string, string | undefined>;
    mkdtemp?: (prefix: string) => Promise<string>;
    mkdir?: (path: string, options: { recursive: boolean }) => Promise<void>;
    copyFile?: (source: string, destination: string) => Promise<void>;
    readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
    writeFile?: (path: string, content: string) => Promise<void>;
    rm?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
    run?: (command: string, args: string[], options: RunCall["options"]) => Promise<void>;
    runCapture?: (
      command: string,
      args: string[],
      options: RunCall["options"],
    ) => Promise<{ stdout: string }>;
  }) => Promise<{ image: string; platform: string }>;
  linuxArchForNodeArch: (arch?: string) => string;
  resolveGoreleaserTagEnv: (options: {
    env?: Record<string, string | undefined>;
    repoRoot?: string;
    runCapture?: (
      command: string,
      args: string[],
      options: RunCall["options"],
    ) => Promise<{ stdout: string }>;
  }) => Promise<Record<string, string>>;
  localGoreleaserConfig: (config: string, distDir: string) => string;
};

async function loadModule(): Promise<BuildLocalRuntimeImageModule> {
  return (await import(
    new URL("../../../../../scripts/build-local-runtime-image.mjs", import.meta.url).href
  )) as BuildLocalRuntimeImageModule;
}

describe("build-local-runtime-image", () => {
  it("maps supported host architectures to Docker platforms", async () => {
    const { linuxArchForNodeArch } = await loadModule();

    expect(linuxArchForNodeArch("x64")).toBe("amd64");
    expect(linuxArchForNodeArch("arm64")).toBe("arm64");
    expect(() => linuxArchForNodeArch("ppc64")).toThrow(
      "Unsupported local runtime image architecture: ppc64",
    );
  });

  it("constructs GoReleaser and Docker build commands for the host platform", async () => {
    const { LOCAL_RUNTIME_IMAGE, buildLocalRuntimeImage } = await loadModule();
    const calls: Array<
      | { type: "mkdir"; path: string; options: { recursive: boolean } }
      | { type: "copyFile"; source: string; destination: string }
      | { type: "readFile"; path: string; encoding: BufferEncoding }
      | { type: "writeFile"; path: string; content: string }
      | { type: "rm"; path: string; options: { recursive: boolean; force: boolean } }
      | ({ type: "run" } & RunCall)
    > = [];
    const contextDir = "/tmp/zitadel-local-image-test";

    const result = await buildLocalRuntimeImage({
      repoRoot: "/repo",
      tmpdir: "/tmp",
      nodeArch: "arm64",
      env: { CUSTOM_ENV: "1" },
      mkdtemp: async (prefix) => {
        expect(prefix).toBe("/tmp/zitadel-local-image-");
        return contextDir;
      },
      mkdir: async (path, options) => {
        calls.push({ type: "mkdir", path, options });
      },
      copyFile: async (source, destination) => {
        calls.push({ type: "copyFile", source, destination });
      },
      readFile: async (path, encoding) => {
        calls.push({ type: "readFile", path, encoding });
        return "version: 2\nproject_name: nextgen\n";
      },
      writeFile: async (path, content) => {
        calls.push({ type: "writeFile", path, content });
      },
      rm: async (path, options) => {
        calls.push({ type: "rm", path, options });
      },
      runCapture: async (command, args, options) => {
        calls.push({ type: "run", command, args, options });
        return { stdout: "v0.1.0-alpha.1\n" };
      },
      run: async (command, args, options) => {
        calls.push({ type: "run", command, args, options });
      },
    });

    expect(result).toEqual({ image: LOCAL_RUNTIME_IMAGE, platform: "linux/arm64" });
    expect(calls).toContainEqual({
      type: "mkdir",
      path: "/tmp/zitadel-local-image-test/linux/arm64",
      options: { recursive: true },
    });
    expect(calls).toContainEqual({
      type: "copyFile",
      source: "/repo/Dockerfile",
      destination: "/tmp/zitadel-local-image-test/Dockerfile",
    });
    expect(calls).toContainEqual({
      type: "readFile",
      path: "/repo/.goreleaser.yaml",
      encoding: "utf8",
    });
    expect(calls).toContainEqual({
      type: "writeFile",
      path: "/tmp/zitadel-local-image-test/.goreleaser.local.yaml",
      content:
        'dist: "/tmp/zitadel-local-image-test/goreleaser-dist"\nversion: 2\nproject_name: nextgen\n',
    });

    const runCalls = calls.filter((call): call is { type: "run" } & RunCall => {
      return call.type === "run";
    });
    expect(runCalls).toHaveLength(3);
    expect(runCalls[0]).toMatchObject({
      command: "git",
      args: ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--match", "[0-9]*"],
      options: {
        cwd: "/repo",
        env: {
          CUSTOM_ENV: "1",
        },
      },
    });
    expect(runCalls[1]).toMatchObject({
      command: "goreleaser",
      args: [
        "build",
        "--config",
        "/tmp/zitadel-local-image-test/.goreleaser.local.yaml",
        "--snapshot",
        "--clean",
        "--single-target",
        "--id",
        "nextgen",
        "--output",
        "/tmp/zitadel-local-image-test/linux/arm64/nextgen",
      ],
      options: {
        cwd: "/repo",
        env: {
          CUSTOM_ENV: "1",
          GORELEASER_CURRENT_TAG: "v0.1.0-alpha.1",
          GORELEASER_PREVIOUS_TAG: "v0.1.0-alpha.1",
          CGO_ENABLED: "0",
          GOOS: "linux",
          GOARCH: "arm64",
        },
      },
    });
    expect(runCalls[2]).toMatchObject({
      command: "docker",
      args: [
        "build",
        "--platform",
        "linux/arm64",
        "-t",
        "ghcr.io/zitadel/nextgen:local-dev",
        "/tmp/zitadel-local-image-test",
      ],
      options: {
        cwd: "/repo",
        env: {
          CUSTOM_ENV: "1",
        },
      },
    });
    expect(calls.at(-1)).toEqual({
      type: "rm",
      path: "/tmp/zitadel-local-image-test",
      options: { recursive: true, force: true },
    });
  });

  it("cleans the temporary context when a build step fails", async () => {
    const { buildLocalRuntimeImage } = await loadModule();
    const calls: Array<{ type: "run"; command: string } | { type: "rm"; path: string }> = [];

    await expect(
      buildLocalRuntimeImage({
        repoRoot: "/repo",
        nodeArch: "x64",
        mkdtemp: async () => "/tmp/zitadel-local-image-fail",
        mkdir: async () => undefined,
        copyFile: async () => undefined,
        readFile: async () => "version: 2\nproject_name: nextgen\n",
        writeFile: async () => undefined,
        rm: async (path) => {
          calls.push({ type: "rm", path });
        },
        runCapture: async () => ({ stdout: "v0.1.0-alpha.1\n" }),
        run: async (command) => {
          calls.push({ type: "run", command });
          if (command === "docker") {
            throw new Error("docker failed");
          }
        },
      }),
    ).rejects.toThrow("docker failed");

    expect(calls).toEqual([
      { type: "run", command: "goreleaser" },
      { type: "run", command: "docker" },
      { type: "rm", path: "/tmp/zitadel-local-image-fail" },
    ]);
  });

  it("preserves explicit GoReleaser tag overrides", async () => {
    const { resolveGoreleaserTagEnv } = await loadModule();
    const result = await resolveGoreleaserTagEnv({
      repoRoot: "/repo",
      env: {
        GORELEASER_CURRENT_TAG: "v9.9.9",
        GORELEASER_PREVIOUS_TAG: "v9.9.8",
      },
      runCapture: async () => {
        throw new Error("git should not run");
      },
    });

    expect(result).toEqual({});
  });

  it("derives server semver tags while ignoring scoped package tags", async () => {
    const { resolveGoreleaserTagEnv } = await loadModule();
    const result = await resolveGoreleaserTagEnv({
      repoRoot: "/repo",
      env: {},
      runCapture: async (command, args, options) => {
        expect(command).toBe("git");
        expect(args).toEqual([
          "describe",
          "--tags",
          "--abbrev=0",
          "--match",
          "v[0-9]*",
          "--match",
          "[0-9]*",
        ]);
        expect(options.cwd).toBe("/repo");
        return { stdout: "v0.1.0-alpha.1\n" };
      },
    });

    expect(result).toEqual({
      GORELEASER_CURRENT_TAG: "v0.1.0-alpha.1",
      GORELEASER_PREVIOUS_TAG: "v0.1.0-alpha.1",
    });
  });

  it("falls back to an initial server tag when no server semver tag exists", async () => {
    const { resolveGoreleaserTagEnv } = await loadModule();
    const result = await resolveGoreleaserTagEnv({
      repoRoot: "/repo",
      env: {},
      runCapture: async () => {
        throw new Error("no matching server tags");
      },
    });

    expect(result).toEqual({
      GORELEASER_CURRENT_TAG: "v0.0.0",
      GORELEASER_PREVIOUS_TAG: "v0.0.0",
    });
  });

  it("overrides GoReleaser dist in the local config copy", async () => {
    const { localGoreleaserConfig } = await loadModule();

    expect(localGoreleaserConfig("version: 2\n", "/tmp/dist")).toBe(
      'dist: "/tmp/dist"\nversion: 2\n',
    );
    expect(localGoreleaserConfig("version: 2\ndist: old\n", "/tmp/dist")).toBe(
      'version: 2\ndist: "/tmp/dist"\n',
    );
  });
});
