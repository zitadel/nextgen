import { createServer, type IncomingMessage, type Server } from "node:http";

import type { Config } from "@oclif/core";
import { Agent, type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BaseCommand } from "../../../src/lib/oclif/base";
import {
  _resetUserAgentForTesting,
  buildUserAgent,
  installUserAgent,
  processUserAgentFacts,
  type UserAgentFacts,
  userAgentInterceptor,
  withUserAgent,
} from "../../../src/lib/user-agent";

const FACTS: UserAgentFacts = {
  cliVersion: "1.2.3-alpha.4",
  nodeVersion: "v24.12.0",
  platform: "darwin",
  osRelease: "24.6.0",
  arch: "arm64",
  env: {},
};

const BASE = "zitadel-cli/1.2.3-alpha.4 node/v24.12.0 darwin/24.6.0 arch/arm64";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("buildUserAgent", () => {
  it("names the CLI, runtime, OS and architecture", () => {
    expect(buildUserAgent(FACTS)).toBe(BASE);
  });

  it("appends the CI provider and host agent when detected", () => {
    const env = { GITHUB_ACTIONS: "true", CLAUDECODE: "1" };
    expect(buildUserAgent({ ...FACTS, env })).toBe(`${BASE} ci/github_actions host/claude_code`);
  });

  it("reports an unnamed CI as ci/unknown", () => {
    expect(buildUserAgent({ ...FACTS, env: { CI: "1" } })).toBe(`${BASE} ci/unknown`);
  });

  it("omits CI when CI is set to a falsey value", () => {
    expect(buildUserAgent({ ...FACTS, env: { CI: "false" } })).toBe(BASE);
  });

  it.each([
    ["--no-telemetry", {}, false],
    ["DO_NOT_TRACK", { DO_NOT_TRACK: "1" }, undefined],
    ["ZITADEL_TELEMETRY=0", { ZITADEL_TELEMETRY: "0" }, undefined],
  ] as const)("omits the environment once the user opts out with %s", (_, optOut, flag) => {
    const env = { GITHUB_ACTIONS: "true", CLAUDECODE: "1", ...optOut };
    expect(buildUserAgent({ ...FACTS, env, telemetryFlag: flag })).toBe(BASE);
  });

  it("honours an opt-out inside a test shell", () => {
    const env = { GITHUB_ACTIONS: "true", NODE_ENV: "test", DO_NOT_TRACK: "1" };
    expect(buildUserAgent({ ...FACTS, env })).toBe(BASE);
  });

  it("keeps the environment when telemetry is off for a reason the user did not choose", () => {
    const env = { GITHUB_ACTIONS: "true", VITEST: "true" };
    expect(buildUserAgent({ ...FACTS, env })).toBe(`${BASE} ci/github_actions`);
  });

  it("keeps a free-form OS release inside one token", () => {
    const agent = buildUserAgent({ ...FACTS, platform: "linux", osRelease: "6.8.0 (custom)/x" });
    expect(agent).toBe("zitadel-cli/1.2.3-alpha.4 node/v24.12.0 linux/6.8.0__custom__x arch/arm64");
  });

  it("builds from the running process", () => {
    const agent = buildUserAgent(processUserAgentFacts("0.0.0-test", undefined));
    const prefix = `zitadel-cli/0.0.0-test node/${process.version} ${process.platform}/`;
    expect(agent).toMatch(
      new RegExp(`^${escapeRegExp(prefix)}\\S+ arch/${escapeRegExp(process.arch)}( |$)`),
    );
  });
});

describe("withUserAgent", () => {
  it("adds the header when there are none", () => {
    expect(withUserAgent(undefined, "ua")).toEqual(["user-agent", "ua"]);
    expect(withUserAgent(null, "ua")).toEqual(["user-agent", "ua"]);
  });

  it("replaces an existing user agent in a header record, whatever its casing", () => {
    expect(withUserAgent({ "User-Agent": "node", accept: "*/*" }, "ua")).toEqual([
      "accept",
      "*/*",
      "user-agent",
      "ua",
    ]);
  });

  it("replaces an existing user agent in a flat header list", () => {
    expect(withUserAgent(["user-agent", "node", "x-a", "1"], "ua")).toEqual([
      "x-a",
      "1",
      "user-agent",
      "ua",
    ]);
  });

  it("leaves a malformed odd-length list for undici to reject", () => {
    const headers = ["x-a", "1", "x-b"];
    expect(withUserAgent(headers, "ua")).toBe(headers);
  });

  it("keeps repeated and multi-valued headers from an iterable", () => {
    const headers = new Map<string, string | string[] | undefined>([
      ["accept", ["a/b", "c/d"]],
      ["x-empty", undefined],
      ["USER-AGENT", "node"],
    ]);
    expect(withUserAgent(headers, "ua")).toEqual([
      "accept",
      "a/b",
      "accept",
      "c/d",
      "user-agent",
      "ua",
    ]);
  });
});

/**
 * Real loopback round-trips: the interceptor only proves itself against the
 * request that actually reaches a socket, after `fetch` has added its own
 * default `user-agent: node`. Each test starts from the original global
 * dispatcher with nothing installed.
 */
describe("on the wire", () => {
  let server: Server;
  let url: string;
  let original: Dispatcher;
  const received: IncomingMessage[] = [];

  beforeAll(async () => {
    original = getGlobalDispatcher();
    server = createServer((req, res) => {
      received.push(req);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not expose a TCP address");
    }
    url = `http://127.0.0.1:${address.port}/`;
  });

  beforeEach(() => {
    setGlobalDispatcher(original);
    _resetUserAgentForTesting();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    setGlobalDispatcher(original);
    _resetUserAgentForTesting();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** Every `user-agent` value on the request the server saw for this fetch. */
  async function userAgentsOf(init?: RequestInit): Promise<string[]> {
    const response = await fetch(url, init);
    await response.arrayBuffer();
    const raw = received.at(-1)?.rawHeaders ?? [];
    return raw.filter(
      (_, index) => index % 2 === 1 && raw[index - 1]?.toLowerCase() === "user-agent",
    );
  }

  it("leaves requests alone until a user agent is installed", async () => {
    expect(await userAgentsOf()).toEqual(["node"]);
  });

  it("sends the installed user agent on every fetch, overriding the caller's", async () => {
    installUserAgent("zitadel-cli/first");
    expect(await userAgentsOf()).toEqual(["zitadel-cli/first"]);
    expect(await userAgentsOf({ headers: { "User-Agent": "custom" } })).toEqual([
      "zitadel-cli/first",
    ]);
  });

  it("replaces the value on reinstall without stacking interceptors", async () => {
    installUserAgent("zitadel-cli/first");
    const installed = getGlobalDispatcher();
    installUserAgent("zitadel-cli/second");
    expect(getGlobalDispatcher()).toBe(installed);
    expect(await userAgentsOf()).toEqual(["zitadel-cli/second"]);
  });

  it("composes onto a dispatcher that replaced the one it installed", async () => {
    installUserAgent("zitadel-cli/first");
    const replacement = new Agent();
    try {
      setGlobalDispatcher(replacement);
      installUserAgent("zitadel-cli/again");
      expect(await userAgentsOf()).toEqual(["zitadel-cli/again"]);
    } finally {
      setGlobalDispatcher(original);
      await replacement.destroy();
    }
  });

  it("reaches a private dispatcher that composes the interceptor", async () => {
    installUserAgent("zitadel-cli/private");
    const dispatcher = new Agent().compose(userAgentInterceptor);
    try {
      expect(
        await userAgentsOf({ dispatcher } as RequestInit & { dispatcher: Dispatcher }),
      ).toEqual(["zitadel-cli/private"]);
    } finally {
      await dispatcher.destroy();
    }
  });

  describe("from a command", () => {
    class ProbeCommand extends BaseCommand {
      public static override readonly id = "user-agent-test";
      async run(): Promise<void> {
        /* only init() is exercised */
      }
      public async boot(): Promise<void> {
        await this.init();
      }
    }

    function boot(argv: string[]): Promise<void> {
      return new ProbeCommand(argv, { version: "7.7.7-test" } as unknown as Config).boot();
    }

    it("installs the user agent when the command initialises", async () => {
      vi.stubEnv("CLAUDECODE", "1");
      // A developer's own opt-out would otherwise drop the token under test.
      vi.stubEnv("DO_NOT_TRACK", undefined);
      vi.stubEnv("ZITADEL_TELEMETRY", undefined);
      await boot([]);
      const [agent] = await userAgentsOf();
      expect(agent).toMatch(
        /^zitadel-cli\/7\.7\.7-test node\/\S+ \S+ arch\/\S+ .*host\/claude_code$/,
      );
    });

    it("drops the environment under --no-telemetry", async () => {
      vi.stubEnv("CLAUDECODE", "1");
      vi.stubEnv("GITHUB_ACTIONS", "true");
      await boot(["--no-telemetry"]);
      const [agent] = await userAgentsOf();
      expect(agent).toMatch(/^zitadel-cli\/7\.7\.7-test node\/\S+ \S+ arch\/\S+$/);
    });
  });
});
