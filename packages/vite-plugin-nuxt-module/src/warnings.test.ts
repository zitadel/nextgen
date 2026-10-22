import type { ResolvedConfig } from "vite";
import { describe, expect, it, vi } from "vitest";

import {
  afterBuild,
  failOnDeclarationWarnings,
  failOnLoggedWarnings,
  failOnWarnings,
  isAllowed,
  WARNINGS_PLUGIN,
} from "./warnings.ts";

describe("isAllowed", () => {
  it.each([
    ["PLUGIN_TIMINGS", [], true],
    ["EVAL", ["EVAL"], true],
    ["EVAL", [], false],
    [undefined, [], false],
  ])("allows %s with %j: %s", (code, allow, expected) => {
    expect(isAllowed(code, allow)).toBe(expected);
  });
});

describe("failOnWarnings", () => {
  it("throws on a warning log, naming its code", () => {
    expect(() => failOnWarnings([]).onLog("warn", { code: "EVAL", message: "m" }, vi.fn())).toThrow(
      "EVAL: m",
    );
  });

  it("passes other levels to the handler", () => {
    const handler = vi.fn();
    failOnWarnings([]).onLog("info", { message: "m" }, handler);
    expect(handler).toHaveBeenCalledWith("info", { message: "m" });
  });

  it("passes an allowed warning to the handler", () => {
    const handler = vi.fn();
    failOnWarnings(["EVAL"]).onLog("warn", { code: "EVAL", message: "m" }, handler);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("passes a plugin warning allowed by the code its plugin gave it", () => {
    const handler = vi.fn();
    failOnWarnings(["OWN_CODE"]).onLog(
      "warn",
      { code: "PLUGIN_WARNING", pluginCode: "OWN_CODE", message: "m" },
      handler,
    );
    expect(handler).toHaveBeenCalledOnce();
  });

  it("names a failing plugin warning by the code that would allow it", () => {
    expect(() =>
      failOnWarnings([]).onLog(
        "warn",
        { code: "PLUGIN_WARNING", pluginCode: "OWN_CODE", message: "m" },
        vi.fn(),
      ),
    ).toThrow("OWN_CODE: m");
  });

  it("throws from onwarn on a warning without a code", () => {
    expect(() => failOnWarnings([]).onwarn({ message: "m" })).toThrow("warning: m");
  });
});

describe("failOnDeclarationWarnings", () => {
  it("drops a timing report, which the JS build prints", () => {
    const handler = vi.fn();
    failOnDeclarationWarnings([])("warn", { code: "PLUGIN_TIMINGS", message: "m" }, handler);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a plugin warning allowed by the code its plugin gave it", () => {
    const handler = vi.fn();
    failOnDeclarationWarnings(["OWN_CODE"])(
      "warn",
      { code: "PLUGIN_WARNING", pluginCode: "OWN_CODE", message: "m" },
      handler,
    );
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("failOnWarnings outcome", () => {
  it("records the failure before it throws", () => {
    const outcome = { failed: false };
    expect(() =>
      failOnWarnings([], outcome).onLog("warn", { code: "EVAL", message: "m" }, vi.fn()),
    ).toThrow();
    expect(outcome.failed).toBe(true);
  });
});

/** Calls a plugin hook that may be a function or an `{ handler }` object. */
function call(hook: unknown, ...args: unknown[]): unknown {
  type Hook = (...args: unknown[]) => unknown;
  const fn = typeof hook === "function" ? (hook as Hook) : (hook as { handler: Hook }).handler;
  return fn.apply({}, args);
}

describe("failOnLoggedWarnings", () => {
  it("fails the build on a warning Vite logged while resolving the config", () => {
    const outcome = { failed: false };
    const { customLogger, plugin } = failOnLoggedWarnings(outcome);
    call(plugin.config, { logLevel: "silent" });
    customLogger.warn("\u001b[33mYou've set rolldownOptions.output.output\u001b[39m");
    expect(() => call(plugin.buildStart)).toThrow(
      "Vite warned:\nYou've set rolldownOptions.output.output",
    );
    expect(outcome.failed).toBe(true);
  });

  it("fails the build on a warning logged during the build, before the steps after it", () => {
    const { customLogger, plugin } = failOnLoggedWarnings({ failed: false });
    call(plugin.config, { logLevel: "silent" });
    customLogger.warnOnce("chunk is large");
    expect(() => call(plugin.closeBundle)).toThrow("Vite warned:\nchunk is large");
  });

  it("starts every build (a rebuild under --watch) as not failed", () => {
    const outcome = { failed: false };
    const { plugin } = failOnLoggedWarnings(outcome);
    call(plugin.config, { logLevel: "silent" });
    call(plugin.buildEnd, new Error("eval"));
    call(plugin.buildStart);
    expect(outcome.failed).toBe(false);
  });

  it("drops the warnings a failed build logged instead of failing the next one on them", () => {
    const { customLogger, plugin } = failOnLoggedWarnings({ failed: false });
    call(plugin.config, { logLevel: "silent" });
    customLogger.warn("stale");
    call(plugin.renderError, new Error("x"));
    expect(() => call(plugin.buildStart)).not.toThrow();
  });

  it("passes a build that logged no warning", () => {
    const { customLogger, plugin } = failOnLoggedWarnings({ failed: false });
    call(plugin.config, { logLevel: "silent" });
    customLogger.info("built");
    expect(() => call(plugin.closeBundle)).not.toThrow();
  });
});

describe("afterBuild", () => {
  const resolved = (outcome: { failed: boolean }) =>
    ({ plugins: [{ name: WARNINGS_PLUGIN, api: { outcome } }] }) as unknown as ResolvedConfig;

  it("runs the step once the bundle is written", async () => {
    const step = vi.fn();
    const plugin = afterBuild("x", step);
    call(plugin.configResolved, resolved({ failed: false }));
    await call(plugin.closeBundle);
    expect(step).toHaveBeenCalledOnce();
  });

  it("skips the step when the build's warning policy failed it", async () => {
    const step = vi.fn();
    const plugin = afterBuild("x", step);
    call(plugin.configResolved, resolved({ failed: true }));
    await call(plugin.closeBundle);
    expect(step).not.toHaveBeenCalled();
  });

  it("runs the step again after a failed build is followed by one that succeeds", async () => {
    const step = vi.fn();
    const plugin = afterBuild("x", step);
    call(plugin.configResolved, { plugins: [] });
    call(plugin.buildStart);
    call(plugin.buildEnd, new Error("x"));
    await call(plugin.closeBundle);
    call(plugin.buildStart);
    call(plugin.buildEnd);
    await call(plugin.closeBundle);
    expect(step).toHaveBeenCalledOnce();
  });

  it.each([
    ["buildEnd", new Error("x")],
    ["renderError", new Error("x")],
  ])("skips the step after %s reports an error", async (hook, error) => {
    const step = vi.fn();
    const plugin = afterBuild("x", step) as unknown as Record<string, unknown>;
    call(plugin.configResolved, { plugins: [] });
    call(plugin[hook], error);
    await call(plugin.closeBundle);
    expect(step).not.toHaveBeenCalled();
  });
});
