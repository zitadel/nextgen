import { beforeAll, describe, expect, it, vi } from "vitest";

type RunCliModule = {
  cliCwdFor: (env?: Record<string, string | undefined>, fallback?: string) => string;
  commandName: (args: string[]) => string | undefined;
  main: (options: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    buildCli?: (options: { env: Record<string, string | undefined> }) => Promise<void>;
    buildLocalServerBinary?: (options: {
      env: Record<string, string | undefined>;
    }) => Promise<{ path: string; version: string }>;
    buildLocalRuntimeImage?: (options: {
      env: Record<string, string | undefined>;
    }) => Promise<unknown>;
    localRegistryWorkDir?: string;
    prepareLocalRegistry?: (options: Record<string, unknown>) => Promise<{
      env: Record<string, string | undefined>;
    }>;
    run?: (
      command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string | undefined> },
    ) => Promise<void>;
    runCapture?: (
      command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string | undefined> },
    ) => Promise<{ stdout: string; stderr: string }>;
    stderr?: {
      write: (chunk: string) => unknown;
    };
  }) => Promise<void>;
  shouldAutoBuildLocalRuntimeImage: (
    args: string[],
    env?: Record<string, string | undefined>,
  ) => boolean;
  shouldPrepareLocalPackages: (args: string[], env?: Record<string, string | undefined>) => boolean;
  shouldUseLocalServerBinary: (args: string[], env?: Record<string, string | undefined>) => boolean;
};

type BuildLocalRuntimeImageModule = {
  LOCAL_RUNTIME_IMAGE: string;
};

let runCli: RunCliModule;
let runtimeImage: BuildLocalRuntimeImageModule;

const noop = async (): Promise<void> => undefined;

beforeAll(async () => {
  runCli = (await import(
    new URL("../../../../../scripts/run-cli.mjs", import.meta.url).href
  )) as RunCliModule;
  runtimeImage = (await import(
    new URL("../../../../../scripts/build-local-runtime-image.mjs", import.meta.url).href
  )) as BuildLocalRuntimeImageModule;
});

describe("run-cli wrapper", () => {
  it("uses INIT_CWD as the CLI cwd when pnpm runs the script from the repo root", () => {
    expect(runCli.cliCwdFor({ INIT_CWD: "/tmp/myapp" }, "/repo")).toBe("/tmp/myapp");
    expect(runCli.cliCwdFor({}, "/repo")).toBe("/repo");
  });

  it("detects forwarded commands after wrapper flags", () => {
    expect(runCli.commandName(["start"])).toBe("start");
    expect(runCli.commandName(["--cwd", "/tmp/project", "start"])).toBe("start");
    expect(runCli.commandName(["--json", "doctor"])).toBe("doctor");
    expect(runCli.commandName(["--", "status"])).toBe("status");
  });

  it("auto-builds a local runtime image only for explicit Docker start without image overrides", () => {
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--runtime", "binary"], {})).toBe(
      false,
    );
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--runtime=binary"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--runtime", "docker"], {})).toBe(
      true,
    );
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--runtime=docker"], {})).toBe(true);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--help"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "-h"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["--version"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--image", "custom:tag"], {})).toBe(
      false,
    );
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--image=custom:tag"], {})).toBe(
      false,
    );
    expect(
      runCli.shouldAutoBuildLocalRuntimeImage(["start"], {
        ZITADEL_LOCAL_IMAGE: "custom:tag",
      }),
    ).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["doctor"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["setup"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["status"], {})).toBe(false);
  });

  it("prepares local packages only for setup commands that install dependencies", () => {
    expect(runCli.shouldPrepareLocalPackages(["setup"], {})).toBe(true);
    expect(runCli.shouldPrepareLocalPackages(["setup", "--server", "local"], {})).toBe(true);
    expect(runCli.shouldPrepareLocalPackages(["setup", "--dry-run"], {})).toBe(false);
    expect(runCli.shouldPrepareLocalPackages(["setup", "--skip-install"], {})).toBe(false);
    expect(runCli.shouldPrepareLocalPackages(["setup", "--help"], {})).toBe(false);
    expect(runCli.shouldPrepareLocalPackages(["setup", "-h"], {})).toBe(false);
    expect(runCli.shouldPrepareLocalPackages(["doctor"], {})).toBe(false);
    expect(runCli.shouldPrepareLocalPackages(["--version"], {})).toBe(false);
    expect(
      runCli.shouldPrepareLocalPackages(["setup"], {
        ZITADEL_CLI_USE_PUBLIC_PACKAGES: "1",
      }),
    ).toBe(false);
    expect(
      runCli.shouldPrepareLocalPackages(["setup"], {
        ZITADEL_CLI_USE_PUBLIC_PACKAGES: "true",
      }),
    ).toBe(false);
  });

  it("uses a local server binary only for executable binary start commands", () => {
    expect(runCli.shouldUseLocalServerBinary(["start"], {})).toBe(true);
    expect(runCli.shouldUseLocalServerBinary(["start", "--runtime", "binary"], {})).toBe(true);
    expect(runCli.shouldUseLocalServerBinary(["start", "--runtime", "docker"], {})).toBe(false);
    expect(runCli.shouldUseLocalServerBinary(["start", "--image", "custom:tag"], {})).toBe(false);
    expect(runCli.shouldUseLocalServerBinary(["start", "--dry-run"], {})).toBe(false);
    expect(runCli.shouldUseLocalServerBinary(["start", "--help"], {})).toBe(false);
    expect(
      runCli.shouldUseLocalServerBinary(["start"], {
        ZITADEL_SERVER_BINARY: "/tmp/custom-nextgen",
      }),
    ).toBe(false);
  });

  it("builds and injects a local server binary for the default binary start runtime", async () => {
    const calls: string[] = [];
    const env = { PATH: "/bin" };
    let runEnv: Record<string, string | undefined> | undefined;

    await runCli.main({
      args: ["start"],
      env,
      buildCli: async (options) => {
        calls.push("build-cli");
        expect(options.env).toBe(env);
      },
      buildLocalServerBinary: async (options) => {
        calls.push("build-server");
        expect(options.env).toBe(env);
        return { path: "/repo/dist/server/nextgen", version: "dev+abcdef123456" };
      },
      buildLocalRuntimeImage: async (options) => {
        calls.push("build-image");
        expect(options.env).toBe(env);
      },
      run: async (command, args, options) => {
        calls.push("run-cli");
        expect(command).toBe(process.execPath);
        expect(args[0]).toMatch(/apps\/cli\/bin\/run\.js$/);
        expect(args.slice(1)).toEqual(["start"]);
        expect(options.cwd).toBe(process.cwd());
        runEnv = options.env;
      },
    });

    expect(calls).toEqual(["build-cli", "build-server", "run-cli"]);
    expect(runEnv).toMatchObject({
      PATH: "/bin",
      ZITADEL_SERVER_BINARY: "/repo/dist/server/nextgen",
      ZITADEL_SERVER_BINARY_VERSION: "dev+abcdef123456",
    });
    expect(runEnv).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
    expect(env).not.toHaveProperty("ZITADEL_SERVER_BINARY");
    expect(env).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
  });

  it("builds and injects the local image for explicit Docker start without an override", async () => {
    const calls: string[] = [];
    const env = { PATH: "/bin" };
    let runEnv: Record<string, string | undefined> | undefined;

    await runCli.main({
      args: ["start", "--runtime", "docker"],
      env,
      buildCli: async (options) => {
        calls.push("build-cli");
        expect(options.env).toBe(env);
      },
      buildLocalServerBinary: async () => {
        calls.push("build-server");
        return { path: "/repo/dist/server/nextgen", version: "dev+abcdef123456" };
      },
      buildLocalRuntimeImage: async (options) => {
        calls.push("build-image");
        expect(options.env).toBe(env);
      },
      run: async (command, args, options) => {
        calls.push("run-cli");
        expect(command).toBe(process.execPath);
        expect(args[0]).toMatch(/apps\/cli\/bin\/run\.js$/);
        expect(args.slice(1)).toEqual(["start", "--runtime", "docker"]);
        expect(options.cwd).toBe(process.cwd());
        runEnv = options.env;
      },
    });

    expect(calls).toEqual(["build-cli", "build-image", "run-cli"]);
    expect(runEnv).toMatchObject({
      PATH: "/bin",
      ZITADEL_LOCAL_IMAGE: runtimeImage.LOCAL_RUNTIME_IMAGE,
    });
    expect(env).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
  });

  it("skips the builder when start receives --image", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);
    const buildLocalServerBinary = vi.fn(async () => ({
      path: "/repo/dist/server/nextgen",
      version: "dev+abcdef123456",
    }));
    const run = vi.fn(noop);

    await runCli.main({
      args: ["start", "--image", "custom:tag"],
      env: { PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalServerBinary,
      buildLocalRuntimeImage,
      run,
    });

    expect(buildLocalServerBinary).not.toHaveBeenCalled();
    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].env).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
  });

  it("skips the builder when ZITADEL_LOCAL_IMAGE is set", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);
    const buildLocalServerBinary = vi.fn(async () => ({
      path: "/repo/dist/server/nextgen",
      version: "dev+abcdef123456",
    }));
    const run = vi.fn(noop);

    await runCli.main({
      args: ["start"],
      env: { PATH: "/bin", ZITADEL_LOCAL_IMAGE: "custom:tag" },
      buildCli: vi.fn(noop),
      buildLocalServerBinary,
      buildLocalRuntimeImage,
      run,
    });

    expect(buildLocalServerBinary).not.toHaveBeenCalled();
    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].env.ZITADEL_LOCAL_IMAGE).toBe("custom:tag");
  });

  it("preserves an explicit local server binary override for binary start", async () => {
    const buildLocalServerBinary = vi.fn(async () => ({
      path: "/repo/dist/server/nextgen",
      version: "dev+abcdef123456",
    }));
    const run = vi.fn(noop);

    await runCli.main({
      args: ["start", "--runtime", "binary"],
      env: { PATH: "/bin", ZITADEL_SERVER_BINARY: "/tmp/custom-nextgen" },
      buildCli: vi.fn(noop),
      buildLocalServerBinary,
      buildLocalRuntimeImage: vi.fn(noop),
      run,
    });

    expect(buildLocalServerBinary).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].env.ZITADEL_SERVER_BINARY).toBe("/tmp/custom-nextgen");
  });

  it("skips the local server binary build for dry-run start", async () => {
    const buildLocalServerBinary = vi.fn(async () => ({
      path: "/repo/dist/server/nextgen",
      version: "dev+abcdef123456",
    }));

    await runCli.main({
      args: ["start", "--dry-run"],
      env: { PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalServerBinary,
      buildLocalRuntimeImage: vi.fn(noop),
      run: vi.fn(noop),
    });

    expect(buildLocalServerBinary).not.toHaveBeenCalled();
  });

  it("skips the builder for non-start commands", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);
    const buildLocalServerBinary = vi.fn(async () => ({
      path: "/repo/dist/server/nextgen",
      version: "dev+abcdef123456",
    }));

    await runCli.main({
      args: ["doctor"],
      env: { PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalServerBinary,
      buildLocalRuntimeImage,
      run: vi.fn(noop),
    });

    expect(buildLocalServerBinary).not.toHaveBeenCalled();
    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
  });

  it("runs the CLI from the original invocation directory", async () => {
    const run = vi.fn(noop);

    await runCli.main({
      args: ["setup", "--server", "local", "--skip-install"],
      env: { INIT_CWD: "/tmp/myapp", PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage: vi.fn(noop),
      run,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1][0]).toMatch(/apps\/cli\/bin\/run\.js$/);
    expect(run.mock.calls[0]?.[1].slice(1)).toEqual([
      "setup",
      "--server",
      "local",
      "--skip-install",
    ]);
    expect(run.mock.calls[0]?.[2].cwd).toBe("/tmp/myapp");
  });

  it("prepares a local package registry for setup and forwards npm env to the CLI", async () => {
    const prepareLocalRegistry = vi.fn(async (options: Record<string, unknown>) => {
      expect(options.registryUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(options.workDir).toMatch(/tmp\/cli-local-registry$/);
      expect(options.paths).toMatchObject({
        npmrcPath: expect.stringContaining("tmp/cli-local-registry/verdaccio.npmrc"),
        registryLogPath: expect.stringContaining("tmp/cli-local-registry/verdaccio/verdaccio.log"),
      });
      return {
        env: {
          NPM_CONFIG_USERCONFIG: "/tmp/local-registry/verdaccio.npmrc",
          npm_config_registry: "http://127.0.0.1:51234",
        },
      };
    });
    const run = vi.fn(noop);

    await runCli.main({
      args: ["setup", "--server", "local"],
      env: { INIT_CWD: "/tmp/myapp", PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage: vi.fn(noop),
      prepareLocalRegistry,
      run,
    });

    expect(prepareLocalRegistry).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].cwd).toBe("/tmp/myapp");
    expect(run.mock.calls[0]?.[2].env).toMatchObject({
      INIT_CWD: "/tmp/myapp",
      NPM_CONFIG_USERCONFIG: "/tmp/local-registry/verdaccio.npmrc",
      PATH: "/bin",
      npm_config_registry: "http://127.0.0.1:51234",
    });
  });

  it("routes local package preparation command output to stderr in JSON mode", async () => {
    let stderrOutput = "";
    const prepareLocalRegistry = vi.fn(async (options: Record<string, unknown>) => {
      (options.log as (message: string) => void)("preparing local packages");
      const runLocal = options.run as (
        command: string,
        args: string[],
        options: { cwd: string; env: Record<string, string | undefined> },
      ) => Promise<unknown>;
      await runLocal("npm", ["pack"], { cwd: "/repo", env: {} });
      return { env: {} };
    });
    const runCapture = vi.fn(async () => ({
      stderr: "captured stderr\n",
      stdout: "captured stdout\n",
    }));

    await runCli.main({
      args: ["setup", "--server", "local", "--json"],
      env: { INIT_CWD: "/tmp/myapp", PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage: vi.fn(noop),
      prepareLocalRegistry,
      run: vi.fn(noop),
      runCapture,
      stderr: {
        write: (chunk: string) => {
          stderrOutput += chunk;
          return true;
        },
      },
    });

    expect(runCapture).toHaveBeenCalledWith("npm", ["pack"], { cwd: "/repo", env: {} });
    expect(stderrOutput).toContain("[zitadel-cli]");
    expect(stderrOutput).toContain("captured stdout");
    expect(stderrOutput).toContain("captured stderr");
  });
});
