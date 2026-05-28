import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../../../../../src/lib/command-runner";
import { NextScaffolder } from "../../../../../src/lib/orca/scaffolders/next";

describe("NextScaffolder", () => {
  it("invokes create-next-app with the expected command and args", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runner: CommandRunner = (command, args, opts) => {
      calls.push({ command, args, cwd: opts?.cwd });
      return { status: 0, stdout: "", stderr: "" };
    };

    await new NextScaffolder(runner).scaffold("/tmp/proj", "next");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe("npx");
    expect(calls[0]?.args).toEqual([
      "create-next-app@latest",
      ".",
      "--ts",
      "--app",
      "--no-git",
      "--yes",
    ]);
    expect(calls[0]?.cwd).toBe("/tmp/proj");
  });

  it("throws E_VALIDATION when the command exits non-zero", async () => {
    const runner: CommandRunner = () => ({ status: 1, stdout: "", stderr: "boom" });
    await expect(new NextScaffolder(runner).scaffold("/tmp/proj", "next")).rejects.toMatchObject({
      code: "E_VALIDATION",
    });
  });

  it("only supports next", () => {
    const scaffolder = new NextScaffolder();
    expect(scaffolder.canScaffold("next")).toBe(true);
    expect(scaffolder.canScaffold("nuxt")).toBe(false);
  });
});
