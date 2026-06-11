import { beforeAll, describe, expect, it, vi } from "vitest";

type RunCliModule = {
  cliCwdFor: (env?: Record<string, string | undefined>, fallback?: string) => string;
  commandName: (args: string[]) => string | undefined;
  main: (options: {
    args?: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    buildCli?: () => Promise<void>;
    buildLocalRuntimeImage?: (options: {
      env: Record<string, string | undefined>;
    }) => Promise<unknown>;
    run?: (
      command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string | undefined> },
    ) => Promise<void>;
  }) => Promise<void>;
  shouldAutoBuildLocalRuntimeImage: (
    args: string[],
    env?: Record<string, string | undefined>,
  ) => boolean;
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

  it("auto-builds a local runtime image only for start without image overrides", () => {
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start"], {})).toBe(true);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--image", "custom:tag"], {})).toBe(
      false,
    );
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["start", "--image=custom:tag"], {})).toBe(
      false,
    );
    expect(
      runCli.shouldAutoBuildLocalRuntimeImage(["start", "--preview-manifest", "preview.json"], {}),
    ).toBe(false);
    expect(
      runCli.shouldAutoBuildLocalRuntimeImage(["start", "--preview-manifest=preview.json"], {}),
    ).toBe(false);
    expect(
      runCli.shouldAutoBuildLocalRuntimeImage(["start"], {
        ZITADEL_LOCAL_IMAGE: "custom:tag",
      }),
    ).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["doctor"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["setup"], {})).toBe(false);
    expect(runCli.shouldAutoBuildLocalRuntimeImage(["status"], {})).toBe(false);
  });

  it("builds and injects the local image for start without an override", async () => {
    const calls: string[] = [];
    const env = { PATH: "/bin" };
    let runEnv: Record<string, string | undefined> | undefined;

    await runCli.main({
      args: ["start"],
      env,
      buildCli: async () => {
        calls.push("build-cli");
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

    expect(calls).toEqual(["build-cli", "build-image", "run-cli"]);
    expect(runEnv).toMatchObject({
      PATH: "/bin",
      ZITADEL_LOCAL_IMAGE: runtimeImage.LOCAL_RUNTIME_IMAGE,
    });
    expect(env).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
  });

  it("skips the builder when start receives --image", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);
    const run = vi.fn(noop);

    await runCli.main({
      args: ["start", "--image", "custom:tag"],
      env: { PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage,
      run,
    });

    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].env).not.toHaveProperty("ZITADEL_LOCAL_IMAGE");
  });

  it("skips the builder when ZITADEL_LOCAL_IMAGE is set", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);
    const run = vi.fn(noop);

    await runCli.main({
      args: ["start"],
      env: { PATH: "/bin", ZITADEL_LOCAL_IMAGE: "custom:tag" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage,
      run,
    });

    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[2].env.ZITADEL_LOCAL_IMAGE).toBe("custom:tag");
  });

  it("skips the builder for non-start commands", async () => {
    const buildLocalRuntimeImage = vi.fn(noop);

    await runCli.main({
      args: ["doctor"],
      env: { PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage,
      run: vi.fn(noop),
    });

    expect(buildLocalRuntimeImage).not.toHaveBeenCalled();
  });

  it("runs the CLI from the original invocation directory", async () => {
    const run = vi.fn(noop);

    await runCli.main({
      args: ["setup", "--server", "local"],
      env: { INIT_CWD: "/tmp/myapp", PATH: "/bin" },
      buildCli: vi.fn(noop),
      buildLocalRuntimeImage: vi.fn(noop),
      run,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1][0]).toMatch(/apps\/cli\/bin\/run\.js$/);
    expect(run.mock.calls[0]?.[1].slice(1)).toEqual(["setup", "--server", "local"]);
    expect(run.mock.calls[0]?.[2].cwd).toBe("/tmp/myapp");
  });
});
