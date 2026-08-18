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
    release?: { name: string; version: string; tag: string; prerelease: boolean };
    gitInfo?: { commit: string; shortCommit: string; date: string };
    mkdtemp?: (prefix: string) => Promise<string>;
    rm?: (path: string, options: { recursive: boolean; force: boolean }) => Promise<void>;
    run?: (command: string, args: string[], options: RunCall["options"]) => Promise<void>;
    runCapture?: (
      command: string,
      args: string[],
      options: RunCall["options"],
    ) => Promise<{ stdout: string }>;
    prepareDockerContext?: (options: {
      repoRoot: string;
      outDir: string;
      version: string;
      platforms: Array<{ goos: string; goarch: string }>;
    }) => Promise<string>;
  }) => Promise<{ image: string; platform: string }>;
  linuxArchForNodeArch: (arch?: string) => string;
};

// buildServerBinaries verifies the ldflags target package via `go list`; with
// gitInfo injected that is the only capture the image build makes.
const goListStub = async () => ({
  stdout: "github.com/zitadel/nextgen/internal/build\n",
});

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

  it("constructs Go build and Docker Buildx commands for the host platform", async () => {
    const { LOCAL_RUNTIME_IMAGE, buildLocalRuntimeImage } = await loadModule();
    const calls: Array<({ type: "run" } & RunCall) | { type: "rm"; path: string }> = [];

    const result = await buildLocalRuntimeImage({
      repoRoot: "/repo",
      tmpdir: "/tmp",
      nodeArch: "arm64",
      env: { CUSTOM_ENV: "1" },
      release: {
        name: "@zitadel/server",
        version: "0.1.0-alpha.5",
        tag: "v0.1.0-alpha.5",
        prerelease: true,
      },
      gitInfo: {
        commit: "abcdef1234567890",
        shortCommit: "abcdef123456",
        date: "2026-06-16T00:00:00Z",
      },
      mkdtemp: async (prefix) => {
        expect(prefix).toBe("/tmp/zitadel-local-image-");
        return "/tmp/zitadel-local-image-test";
      },
      rm: async (path) => {
        calls.push({ type: "rm", path });
      },
      runCapture: goListStub,
      prepareDockerContext: async (options) => {
        expect(options).toMatchObject({
          repoRoot: "/repo",
          outDir: "/tmp/zitadel-local-image-test",
          version: "0.1.0-alpha.5",
          platforms: [{ goos: "linux", goarch: "arm64" }],
        });
        return "/tmp/zitadel-local-image-test/docker-context";
      },
      run: async (command, args, options) => {
        calls.push({ type: "run", command, args, options });
      },
    });

    expect(result).toEqual({ image: LOCAL_RUNTIME_IMAGE, platform: "linux/arm64" });
    const runCalls = calls.filter((call): call is { type: "run" } & RunCall => {
      return call.type === "run";
    });
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0]).toMatchObject({
      command: "go",
      args: [
        "build",
        "-trimpath",
        "-ldflags",
        // A local dev image is not a release: it carries the source-build
        // version, not release.version, so its logs and OTel service.version
        // cannot be mistaken for the published binary.
        "-s -w -X github.com/zitadel/nextgen/internal/build.version=dev+abcdef123456 -X github.com/zitadel/nextgen/internal/build.commit=abcdef1234567890 -X github.com/zitadel/nextgen/internal/build.date=2026-06-16T00:00:00Z",
        "-o",
        "/tmp/zitadel-local-image-test/build/linux/arm64/nextgen",
        ".",
      ],
      options: {
        cwd: "/repo",
        env: {
          CUSTOM_ENV: "1",
          CGO_ENABLED: "0",
          GOOS: "linux",
          GOARCH: "arm64",
        },
      },
    });
    expect(runCalls[1]).toMatchObject({
      command: "docker",
      args: [
        "buildx",
        "build",
        "--platform",
        "linux/arm64",
        "-f",
        "/tmp/zitadel-local-image-test/docker-context/Dockerfile",
        "-t",
        "ghcr.io/zitadel/nextgen:local-dev",
        "--load",
        "/tmp/zitadel-local-image-test/docker-context",
      ],
      options: {
        cwd: "/repo",
      },
    });
    expect(calls.at(-1)).toEqual({ type: "rm", path: "/tmp/zitadel-local-image-test" });
  });

  it("cleans the temporary context when Docker build fails", async () => {
    const { buildLocalRuntimeImage } = await loadModule();
    const calls: Array<{ type: "run"; command: string } | { type: "rm"; path: string }> = [];

    await expect(
      buildLocalRuntimeImage({
        repoRoot: "/repo",
        nodeArch: "x64",
        release: {
          name: "@zitadel/server",
          version: "0.1.0-alpha.5",
          tag: "v0.1.0-alpha.5",
          prerelease: true,
        },
        gitInfo: {
          commit: "abcdef1234567890",
          shortCommit: "abcdef123456",
          date: "2026-06-16T00:00:00Z",
        },
        mkdtemp: async () => "/tmp/zitadel-local-image-fail",
        runCapture: goListStub,
        rm: async (path) => {
          calls.push({ type: "rm", path });
        },
        prepareDockerContext: async () => "/tmp/zitadel-local-image-fail/docker-context",
        run: async (command) => {
          calls.push({ type: "run", command });
          if (command === "docker") {
            throw new Error("docker failed");
          }
        },
      }),
    ).rejects.toThrow("docker failed");

    expect(calls).toEqual([
      { type: "run", command: "go" },
      { type: "run", command: "docker" },
      { type: "rm", path: "/tmp/zitadel-local-image-fail" },
    ]);
  });
});
