import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PM, type PMName } from "@/lib/pm";
import { scratchDir } from "@tests/fixtures/scratch";
import { rejectionOf } from "@tests/helpers/thrown-value";

async function tempProject(): Promise<string> {
  const dir = await scratchDir("zitadel-pm-");
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  return dir;
}

describe("PackageCommand.inDirectory", () => {
  it("leaves a command alone for a run without --cwd", () => {
    expect(PM.named("npm").dev().inDirectory(undefined, "/work/shop").display).toBe("npm run dev");
  });

  it.each([
    ["npm", "npm --prefix shop run dev"],
    ["pnpm", "pnpm --dir shop dev"],
    ["yarn", "yarn --cwd /work/shop dev"],
    ["bun", "bun --cwd /work/shop run dev"],
  ] satisfies Array<[PMName, string]>)(
    "runs %s's dev script in the --cwd directory from the shell's",
    (packageManager, display) => {
      expect(PM.named(packageManager).dev().inDirectory("shop", "/work/shop").display).toBe(
        display,
      );
    },
  );

  it("quotes a directory the shell would split", () => {
    expect(PM.named("npm").dev().inDirectory("my shop", "/work/my shop").display).toBe(
      "npm --prefix 'my shop' run dev",
    );
  });
});

describe("PackageCommand.run with its output captured", () => {
  /**
   * A project whose `talk` script prints a line to each stream, then exits
   * with `code`.
   */
  async function talkingProject(code: number): Promise<string> {
    const dir = await tempProject();
    const script = `console.log('to stdout'); console.error('to stderr'); process.exit(${String(code)})`;
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { talk: `node -e "${script}"` } }),
    );
    return dir;
  }

  it("prints nothing", async () => {
    const dir = await talkingProject(0);
    const write = vi.spyOn(process.stderr, "write");

    await PM.named("npm").script("talk").run({
      cwd: dir,
      env: process.env,
      captureOutput: true,
    });
    const written = write.mock.calls.join("");
    write.mockRestore();

    expect(written).not.toContain("to std");
  });

  it("puts what the command printed on the error a failure throws", async () => {
    const dir = await talkingProject(1);

    const error = await rejectionOf(() => {
      return PM.named("npm").script("talk").run({
        cwd: dir,
        env: process.env,
        captureOutput: true,
      });
    });

    expect(error).toMatchObject({ output: expect.stringContaining("to stdout") });
    expect(error).toMatchObject({ output: expect.stringContaining("to stderr") });
  });
});
