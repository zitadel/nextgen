import { describe, expect, it } from "vitest";

import { RunContext } from "@/cli/core/run-context";

/**
 * What a command says of itself that takes a server and resolves it to a fixed one.
 *
 * @param takesServer - Whether it declares `--server`.
 * @returns The facts.
 */
function aCommand(takesServer: boolean) {
  return {
    id: "variable:get",
    version: "1.2.3",
    source: undefined,
    takesServer,
    resolveServer: async (_cwd: string, flag: string | undefined) => {
      return flag ?? "https://resolved.example";
    },
  };
}

describe("RunContext", () => {
  describe("from", () => {
    it("reads the flags a run was given into its context", async () => {
      const context = await RunContext.from(
        { "dry-run": true, force: true, debug: true, verbose: true, "non-interactive": true },
        aCommand(false),
        false,
      );

      expect(context.meta).toMatchObject({
        dryRun: true,
        force: true,
        debug: true,
        verbose: true,
        nonInteractive: true,
        command: "variable:get",
        cliVersion: "1.2.3",
      });
    });

    it("takes the server the flag names when the command declares --server", async () => {
      const context = await RunContext.from(
        { server: "https://given.example" },
        aCommand(true),
        false,
      );

      expect(context.meta).toMatchObject({
        source: "https://given.example",
        serverFlag: "https://given.example",
      });
      expect(context.scope).toMatchObject({ server: "https://given.example" });
    });

    it("ignores a server flag the command does not declare", async () => {
      const context = await RunContext.from(
        { server: "https://given.example" },
        aCommand(false),
        false,
      );

      expect(context.meta.serverFlag).toBeUndefined();
    });

    it("lets a server the command fixes beforehand win over resolving one", async () => {
      const context = await RunContext.from(
        {},
        { ...aCommand(true), source: "https://fixed.example" },
        false,
      );

      expect(context.meta.source).toBe("https://fixed.example");
    });

    it("cannot ask anyone under --json", async () => {
      const context = await RunContext.from({}, aCommand(false), true);

      expect(context.meta.nonInteractive).toBe(true);
    });

    it("turns colour off for --no-color", async () => {
      const context = await RunContext.from({ color: false }, aCommand(false), false);

      expect(context.colored).toBe(false);
    });
  });

  describe("fromArgv", () => {
    it("reads the directory and server a command line named before any flag was parsed", async () => {
      const context = await RunContext.fromArgv(
        RunContext.fallback("1.2.3"),
        ["--cwd", "/tmp/app", "--server=https://typed.example"],
        aCommand(true),
      );

      expect(context.meta).toMatchObject({ source: "https://typed.example" });
      expect(context.meta.cwd).toBe("/tmp/app");
    });

    it("leaves the server to the failure when it cannot be resolved", async () => {
      const context = await RunContext.fromArgv(RunContext.fallback("1.2.3"), ["--server", "x"], {
        ...aCommand(true),
        resolveServer: async () => {
          throw new Error("not a server");
        },
      });

      expect(context.meta.source).toBe("");
    });
  });

  describe("forcedColour", () => {
    it.each([
      [{ FORCE_COLOR: "1" }, true],
      [{ FORCE_COLOR: "true" }, true],
      [{ FORCE_COLOR: "0" }, false],
      [{ FORCE_COLOR: "FALSE" }, false],
      [{ FORCE_COLOR: "" }, undefined],
      [{}, undefined],
    ])("reads %j as %s", (env, expected) => {
      expect(RunContext.forcedColour(env)).toBe(expected);
    });
  });

  describe("argvValue", () => {
    it("reads --name value and --name=value, and nothing else", () => {
      expect(RunContext.argvValue(["--cwd", "a"], "--cwd", "-c")).toBe("a");
      expect(RunContext.argvValue(["--cwd=b"], "--cwd", "-c")).toBe("b");
      expect(RunContext.argvValue(["-c", "c"], "--cwd", "-c")).toBe("c");
      expect(RunContext.argvValue(["--other", "d"], "--cwd", "-c")).toBeUndefined();
    });
  });
});
