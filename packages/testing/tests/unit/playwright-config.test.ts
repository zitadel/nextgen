import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nextAppEnv } from "../../src/app-env";
import { parseAppRunnerConfig, parseSupervisorConfig } from "../../src/orchestration";
import { withZitadel, type WithZitadelOptions } from "../../src/playwright-config";

const fakeResolve = (name: "supervisor" | "app-runner"): string => `/kit/dist/${name}.mjs`;

/** `app` is optional on the type (the instance may serve the app itself) but
 * always present here, so the cases below can reach into it without guards. */
type OptionsWithApp = WithZitadelOptions & { app: NonNullable<WithZitadelOptions["app"]> };

const options = (): OptionsWithApp => ({
  configDir: "/repo/apps/my-e2e",
  port: 8092,
  appOrigin: "http://localhost:3002",
  zitadel: {
    serverBinary: "/repo/dist/server/nextgen",
    serverBinaryHint: "run `moon run server:build` first.",
  },
  app: {
    command: ["corepack", "pnpm", "--filter", "my-app", "dev"],
    cwd: "/repo",
    readyPath: "/login",
    env: nextAppEnv,
  },
});

describe("withZitadel", () => {
  let handshakeBefore: string | undefined;
  beforeEach(() => {
    handshakeBefore = process.env.ZITADEL_TESTING_HANDSHAKE;
  });
  afterEach(() => {
    if (handshakeBefore === undefined) {
      delete process.env.ZITADEL_TESTING_HANDSHAKE;
    } else {
      process.env.ZITADEL_TESTING_HANDSHAKE = handshakeBefore;
    }
  });

  it("generates the boot and app entries with agreeing readiness URLs", () => {
    const { webServer } = withZitadel(options(), fakeResolve);
    expect(webServer).toHaveLength(2);
    const [boot, app] = [webServer[0]!, webServer[1]!];
    expect(boot.command).toBe('node "/kit/dist/supervisor.mjs"');
    expect(boot.url).toBe("http://localhost:8092/healthz");
    expect(boot.reuseExistingServer).toBe(false);
    expect(boot.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 30_000 });
    expect(app.command).toBe('node "/kit/dist/app-runner.mjs"');
    expect(app.url).toBe("http://localhost:3002/login");
    expect(app.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 15_000 });
  });

  it("serializes configs the executables' own parsers accept", () => {
    const { webServer } = withZitadel(options(), fakeResolve);
    const [boot, app] = [webServer[0]!, webServer[1]!];
    const supervisor = parseSupervisorConfig(boot.env?.ZITADEL_TESTING_SUPERVISOR);
    expect(supervisor.port).toBe(8092);
    expect(supervisor.appOrigins).toEqual(["http://localhost:3002"]);
    expect(supervisor.serverBinary).toBe("/repo/dist/server/nextgen");
    expect(supervisor.serverBinaryHint).toMatch(/server:build/);
    const runner = parseAppRunnerConfig(app.env?.ZITADEL_TESTING_APP_RUNNER);
    expect(runner.command).toEqual(["corepack", "pnpm", "--filter", "my-app", "dev"]);
    expect(runner.cwd).toBe("/repo");
    expect(runner.env).toEqual(nextAppEnv);
    expect(runner.handshakeTimeoutMs).toBe(180_000);
  });

  it("points both entries and the fixtures at the same handshake file", () => {
    const { webServer } = withZitadel(options(), fakeResolve);
    const expected = join("/repo/apps/my-e2e", ".zitadel-testing", "handshake.json");
    expect(process.env.ZITADEL_TESTING_HANDSHAKE).toBe(expected);
    for (const entry of webServer) {
      expect(entry.env?.ZITADEL_TESTING_HANDSHAKE).toBe(expected);
    }
  });

  it("honors a custom handshake path and timeout overrides", () => {
    const custom = options();
    custom.handshakePath = "/tmp/custom-handshake.json";
    custom.zitadel = { ...custom.zitadel, bootTimeoutMs: 5_000 };
    custom.app.readyTimeoutMs = 7_000;
    custom.app.gracefulShutdownMs = 1_000;
    const { webServer } = withZitadel(custom, fakeResolve);
    const [boot, app] = [webServer[0]!, webServer[1]!];
    expect(process.env.ZITADEL_TESTING_HANDSHAKE).toBe("/tmp/custom-handshake.json");
    expect(boot.timeout).toBe(5_000);
    expect(app.timeout).toBe(7_000);
    expect(app.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 1_000 });
    expect(parseAppRunnerConfig(app.env?.ZITADEL_TESTING_APP_RUNNER).handshakeTimeoutMs).toBe(
      7_000,
    );
  });

  it("rejects options that cannot produce a working suite", () => {
    const relDir = options();
    relDir.configDir = "apps/my-e2e";
    expect(() => withZitadel(relDir, fakeResolve)).toThrow(/configDir must be absolute/);

    const badPort = options();
    badPort.port = 0;
    expect(() => withZitadel(badPort, fakeResolve)).toThrow(/port must be a positive integer/);

    // "localhost:" parses as a URL scheme, so a plain canParse check would
    // accept this and fail later with an unhelpful "Invalid URL".
    const badOrigin = options();
    badOrigin.appOrigin = "localhost:3002";
    expect(() => withZitadel(badOrigin, fakeResolve)).toThrow(/appOrigin must be an origin/);

    const originWithPath = options();
    originWithPath.appOrigin = "http://localhost:3002/app";
    expect(() => withZitadel(originWithPath, fakeResolve)).toThrow(/appOrigin must be an origin/);

    const badReady = options();
    badReady.app.readyPath = "login";
    expect(() => withZitadel(badReady, fakeResolve)).toThrow(/readyPath must start with "\/"/);

    const noCommand = options();
    noCommand.app.command = [];
    expect(() => withZitadel(noCommand, fakeResolve)).toThrow(/command must not be empty/);

    const relCwd = options();
    relCwd.app.cwd = "apps/my-app";
    expect(() => withZitadel(relCwd, fakeResolve)).toThrow(/cwd must be absolute/);

    // The executables resolve paths against configDir, so relative path
    // options would point somewhere the consumer did not intend.
    const relBinary = options();
    relBinary.zitadel = { ...relBinary.zitadel, serverBinary: "dist/server/nextgen" };
    expect(() => withZitadel(relBinary, fakeResolve)).toThrow(
      /zitadel\.serverBinary must be an absolute path/,
    );

    const relStateDir = options();
    relStateDir.zitadel = { ...relStateDir.zitadel, dir: ".zitadel-state" };
    expect(() => withZitadel(relStateDir, fakeResolve)).toThrow(
      /zitadel\.dir must be an absolute path/,
    );

    const relHandshake = options();
    relHandshake.handshakePath = "handshake.json";
    expect(() => withZitadel(relHandshake, fakeResolve)).toThrow(
      /handshakePath must be an absolute path/,
    );
  });

  // The Zitadel binary embeds the console and hosted login shells, so a suite
  // testing those has no app server to boot — and booting one would defeat the
  // point, since a dev server's proxy rewrites the API requests the binary
  // serves directly.
  describe("when the instance serves the app itself", () => {
    const embedded = (): WithZitadelOptions => {
      const { app: _app, ...rest } = options();
      return { ...rest, appOrigin: "http://localhost:8092" };
    };

    it("generates the boot entry alone", () => {
      const { webServer } = withZitadel(embedded(), fakeResolve);
      expect(webServer).toHaveLength(1);
      const boot = webServer[0]!;
      expect(boot.command).toBe('node "/kit/dist/supervisor.mjs"');
      expect(boot.url).toBe("http://localhost:8092/healthz");
      // The fixtures still resolve the instance through the handshake.
      const expected = join("/repo/apps/my-e2e", ".zitadel-testing", "handshake.json");
      expect(process.env.ZITADEL_TESTING_HANDSHAKE).toBe(expected);
      expect(boot.env?.ZITADEL_TESTING_HANDSHAKE).toBe(expected);
      // The instance's own origin is still registered as a preview origin.
      expect(parseSupervisorConfig(boot.env?.ZITADEL_TESTING_SUPERVISOR).appOrigins).toEqual([
        "http://localhost:8092",
      ]);
    });

    it("rejects an appOrigin nothing will serve", () => {
      // Left at the app-server origin by mistake: with no app entry, Playwright
      // would poll :3002 forever (or, worse, hit a stale server there).
      expect(() => withZitadel({ ...embedded(), appOrigin: "http://localhost:3002" }, fakeResolve))
        .toThrow(/appOrigin must point at the instance's own port \(8092\)/);
    });

    it("accepts any hostname that reaches the instance's port", () => {
      expect(() =>
        withZitadel({ ...embedded(), appOrigin: "http://127.0.0.1:8092" }, fakeResolve),
      ).not.toThrow();
    });
  });

  it("demands the built package when resolving executables for real", () => {
    // Under vitest this module is loaded from src/*.ts, which can never be
    // spawned as a webServer command; the default resolver must say so.
    expect(() => withZitadel(options())).toThrow(/built package/);
  });
});
