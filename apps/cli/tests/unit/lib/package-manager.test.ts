import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addCommandFor,
  addExactCommandFor,
  detectPackageManager,
  devCommandFor,
  inDirectory,
  installCommandFor,
  type PackageManager,
  removeCommandFor,
  runPackageCommand,
  runScriptCommandFor,
} from "@/lib/package-manager";
import { rejectionOf } from "@tests/helpers/thrown-value";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-pm-"));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  return dir;
}

/**
 * A repository's root in a new temporary directory: a directory holding `.git`.
 *
 * @returns The root.
 */
async function tempRepository(): Promise<string> {
  const root = await tempProject();
  await mkdir(join(root, ".git"));
  return root;
}

/**
 * An app of a workspace, at `apps/web` under `root`, with a `package.json`
 * that names no package manager.
 *
 * @param root - The workspace's root.
 * @returns The app's directory.
 */
async function memberApp(root: string): Promise<string> {
  const app = join(root, "apps", "web");
  await mkdir(app, { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "web" }));
  return app;
}

describe("package manager detection", () => {
  it("prefers package.json#packageManager over lockfiles", async () => {
    const cwd = await tempProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", packageManager: "pnpm@10.33.2" }),
    );
    await writeFile(join(cwd, "package-lock.json"), "{}");

    expect(await detectPackageManager(cwd)).toBe("pnpm");
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] satisfies Array<[string, PackageManager]>)("detects %s", async (file, expected) => {
    const cwd = await tempProject();
    await writeFile(join(cwd, file), "");

    expect(await detectPackageManager(cwd)).toBe(expected);
  });

  it("falls back to npm", async () => {
    expect(await detectPackageManager(await tempProject())).toBe("npm");
  });

  it("reads a workspace's lockfile at the repository's root", async () => {
    const root = await tempRepository();
    await writeFile(join(root, "pnpm-lock.yaml"), "");

    expect(await detectPackageManager(await memberApp(root))).toBe("pnpm");
  });

  it("reads a workspace's packageManager field at the repository's root", async () => {
    const root = await tempRepository();
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0" }));

    expect(await detectPackageManager(await memberApp(root))).toBe("yarn");
  });

  it("prefers what the app itself names over the repository's root", async () => {
    const root = await tempRepository();
    await writeFile(join(root, "pnpm-lock.yaml"), "");
    const app = await memberApp(root);
    await writeFile(join(app, "bun.lock"), "");

    expect(await detectPackageManager(app)).toBe("bun");
  });

  it("reads nothing above the repository's root", async () => {
    const outside = await tempProject();
    await writeFile(join(outside, "pnpm-lock.yaml"), "");
    const root = join(outside, "repo");
    await mkdir(join(root, ".git"), { recursive: true });

    expect(await detectPackageManager(await memberApp(root))).toBe("npm");
  });

  it("reads nothing above a project outside any repository", async () => {
    const outside = await tempProject();
    await writeFile(join(outside, "pnpm-lock.yaml"), "");

    expect(await detectPackageManager(await memberApp(outside))).toBe("npm");
  });
});

describe("package manager commands", () => {
  it.each([
    ["npm", "npm install", "npm run dev"],
    ["pnpm", "pnpm install", "pnpm dev"],
    ["yarn", "yarn install", "yarn dev"],
    ["bun", "bun install", "bun run dev"],
  ] satisfies Array<[PackageManager, string, string]>)(
    "maps %s commands",
    (packageManager, install, dev) => {
      expect(installCommandFor(packageManager).display).toBe(install);
      expect(devCommandFor(packageManager).display).toBe(dev);
    },
  );

  it.each([
    ["npm", "npm install pkg@1", "npm uninstall pkg"],
    ["pnpm", "pnpm add pkg@1", "pnpm remove pkg"],
    ["yarn", "yarn add pkg@1", "yarn remove pkg"],
    ["bun", "bun add pkg@1", "bun remove pkg"],
  ] satisfies Array<[PackageManager, string, string]>)(
    "adds and removes a package with %s",
    (packageManager, add, remove) => {
      expect(addCommandFor(packageManager, ["pkg@1"]).display).toBe(add);
      expect(removeCommandFor(packageManager, ["pkg"]).display).toBe(remove);
    },
  );

  it("leaves a command alone for a run without --cwd", () => {
    expect(inDirectory(devCommandFor("npm"), undefined, "/work/shop").display).toBe("npm run dev");
  });

  it.each([
    ["npm", "npm --prefix shop run dev"],
    ["pnpm", "pnpm --dir shop dev"],
    ["yarn", "yarn --cwd /work/shop dev"],
    ["bun", "bun --cwd /work/shop run dev"],
  ] satisfies Array<[PackageManager, string]>)(
    "runs %s's dev script in the --cwd directory from the shell's",
    (packageManager, display) => {
      expect(inDirectory(devCommandFor(packageManager), "shop", "/work/shop").display).toBe(
        display,
      );
    },
  );

  it("quotes a directory the shell would split", () => {
    expect(inDirectory(devCommandFor("npm"), "my shop", "/work/my shop").display).toBe(
      "npm --prefix 'my shop' run dev",
    );
  });

  // The exact-save flag is the point: every manager's default save prefix is
  // a caret range, which would float a deliberately exact pin.
  it.each([
    ["npm", "npm install --save-exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["pnpm", "pnpm add --save-exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["yarn", "yarn add --exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["bun", "bun add --exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
  ] satisfies Array<[PackageManager, string]>)("maps %s exact adds", (packageManager, display) => {
    expect(
      addExactCommandFor(packageManager, ["@zitadel/sdk-next@0.1.0", "@zitadel/testing@0.1.0"])
        .display,
    ).toBe(display);
  });

  it.each([
    ["npm", "npm run test:e2e"],
    ["pnpm", "pnpm run test:e2e"],
    ["yarn", "yarn run test:e2e"],
    ["bun", "bun run test:e2e"],
  ] satisfies Array<[PackageManager, string]>)(
    "runs a project script with %s",
    (packageManager, display) => {
      expect(runScriptCommandFor(packageManager, "test:e2e").display).toBe(display);
    },
  );
});

describe("runPackageCommand with its output captured", () => {
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

    await runPackageCommand(runScriptCommandFor("npm", "talk"), {
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
      return runPackageCommand(runScriptCommandFor("npm", "talk"), {
        cwd: dir,
        env: process.env,
        captureOutput: true,
      });
    });

    expect(error).toMatchObject({ output: expect.stringContaining("to stdout") });
    expect(error).toMatchObject({ output: expect.stringContaining("to stderr") });
  });
});
