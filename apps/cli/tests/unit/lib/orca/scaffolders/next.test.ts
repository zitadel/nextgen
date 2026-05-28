import { describe, expect, it } from "vitest";

import type { CommandRunner } from "../../../../../src/lib/orca/scaffolders/cli";
import { NextScaffolder } from "../../../../../src/lib/orca/scaffolders/next";

describe("NextScaffolder", () => {
  it("invokes create-next-app with the expected command and args", async () => {
    const calls: Array<{ command: string; args: ReadonlyArray<string>; cwd: string }> = [];
    const runner: CommandRunner = (command, args, cwd) => {
      calls.push({ command, args, cwd });
      return { status: 0, stderr: "" };
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
    const runner: CommandRunner = () => ({ status: 1, stderr: "boom" });
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
