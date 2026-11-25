import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect } from "vitest";

import { PM, PmCommandFailedError, type PMName, type Runner } from "@/lib/pm";
import { log, Output } from "@/lib/ui";
import { it } from "@tests/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

/**
 * Makes a directory a project: it gets a `package.json` that names no package manager.
 *
 * @param dir - The directory to make a project.
 * @returns The directory.
 */
async function tempProject(dir: string): Promise<string> {
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo" }));
  return dir;
}

/**
 * Makes a directory a repository's root: a project holding `.git`.
 *
 * @param root - The directory to make the root.
 * @returns The root.
 */
async function tempRepository(root: string): Promise<string> {
  await tempProject(root);
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
  it("prefers package.json#packageManager over lockfiles", async ({ dir: cwd }) => {
    await tempProject(cwd);
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", packageManager: "pnpm@10.33.2" }),
    );
    await writeFile(join(cwd, "package-lock.json"), "{}");

    expect((await PM.detect(cwd)).name).toBe("pnpm");
  });

  it.for([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] satisfies Array<[string, PMName]>)("detects %s", async ([file, expected], { dir: cwd }) => {
    await tempProject(cwd);
    await writeFile(join(cwd, file), "");

    expect((await PM.detect(cwd)).name).toBe(expected);
  });

  it("falls back to npm", async ({ dir }) => {
    expect((await PM.detect(await tempProject(dir))).name).toBe("npm");
  });

  it("reads a workspace's lockfile at the repository's root", async ({ dir: root }) => {
    await tempRepository(root);
    await writeFile(join(root, "pnpm-lock.yaml"), "");

    expect((await PM.detect(await memberApp(root))).name).toBe("pnpm");
  });

  it("reads a workspace's packageManager field at the repository's root", async ({ dir: root }) => {
    await tempRepository(root);
    await writeFile(join(root, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0" }));

    expect((await PM.detect(await memberApp(root))).name).toBe("yarn");
  });

  it("prefers what the app itself names over the repository's root", async ({ dir: root }) => {
    await tempRepository(root);
    await writeFile(join(root, "pnpm-lock.yaml"), "");
    const app = await memberApp(root);
    await writeFile(join(app, "bun.lock"), "");

    expect((await PM.detect(app)).name).toBe("bun");
  });

  it("reads nothing above the repository's root", async ({ dir: outside }) => {
    await tempProject(outside);
    await writeFile(join(outside, "pnpm-lock.yaml"), "");
    const root = join(outside, "repo");
    await mkdir(join(root, ".git"), { recursive: true });

    expect((await PM.detect(await memberApp(root))).name).toBe("npm");
  });

  it("reads nothing above a project outside any repository", async ({ dir: outside }) => {
    await tempProject(outside);
    await writeFile(join(outside, "pnpm-lock.yaml"), "");

    expect((await PM.detect(await memberApp(outside))).name).toBe("npm");
  });
});

describe("package manager commands", () => {
  it.each([
    ["npm", "npm install", "npm run dev"],
    ["pnpm", "pnpm install", "pnpm dev"],
    ["yarn", "yarn install", "yarn dev"],
    ["bun", "bun install", "bun run dev"],
  ] satisfies Array<[PMName, string, string]>)(
    "maps %s commands",
    (packageManager, install, dev) => {
      expect(PM.named(packageManager).install().display).toBe(install);
      expect(PM.named(packageManager).dev().display).toBe(dev);
    },
  );

  it.each([
    ["npm", "npm install pkg@1", "npm uninstall pkg"],
    ["pnpm", "pnpm add pkg@1", "pnpm remove pkg"],
    ["yarn", "yarn add pkg@1", "yarn remove pkg"],
    ["bun", "bun add pkg@1", "bun remove pkg"],
  ] satisfies Array<[PMName, string, string]>)(
    "adds and removes a package with %s",
    (packageManager, add, remove) => {
      expect(PM.named(packageManager).add(["pkg@1"]).display).toBe(add);
      expect(PM.named(packageManager).remove(["pkg"]).display).toBe(remove);
    },
  );

  // The exact-save flag is the point: every manager's default save prefix is
  // a caret range, which would float a deliberately exact pin.
  it.each([
    ["npm", "npm install --save-exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["pnpm", "pnpm add --save-exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["yarn", "yarn add --exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
    ["bun", "bun add --exact @zitadel/sdk-next@0.1.0 @zitadel/testing@0.1.0"],
  ] satisfies Array<[PMName, string]>)("maps %s exact adds", (packageManager, display) => {
    expect(
      PM.named(packageManager).addExact(["@zitadel/sdk-next@0.1.0", "@zitadel/testing@0.1.0"])
        .display,
    ).toBe(display);
  });

  it.each([
    ["npm", "npm run test:e2e"],
    ["pnpm", "pnpm run test:e2e"],
    ["yarn", "yarn run test:e2e"],
    ["bun", "bun run test:e2e"],
  ] satisfies Array<[PMName, string]>)(
    "runs a project script with %s",
    (packageManager, display) => {
      expect(PM.named(packageManager).script("test:e2e").display).toBe(display);
    },
  );
});

/**
 * What a package manager is run with.
 */
type RunOptions = Parameters<Runner>[1];

describe("PM.installDependencies with the json option left out", () => {
  afterEach(() => {
    Output.settle({ json: false, color: false });
  });

  /**
   * Installs what a command added, with the run of the package manager recorded in place of run.
   *
   * @param dir - The project directory.
   * @returns The options the package manager was run with.
   */
  async function installed(dir: string): Promise<RunOptions[]> {
    const received: RunOptions[] = [];

    await PM.named("npm").installDependencies(
      { needed: true, dryRun: false, skipInstall: false },
      {
        cwd: dir,
        env: {},
        task: async (_label, work) => {
          return work();
        },
        log,
        run: async (_command, options) => {
          received.push(options);
        },
      },
    );

    return received;
  }

  it("keeps the package manager's output off stdout when the run answers in JSON", async ({
    dir,
  }) => {
    Output.settle({ json: true, color: false });

    const received = await installed(dir);

    expect(received[0]?.redirectStdoutToStderr).toBe(true);
  });

  it("leaves the package manager's output alone when the run does not answer in JSON", async ({
    dir,
  }) => {
    Output.settle({ json: false, color: false });

    const received = await installed(dir);

    expect(received[0]?.redirectStdoutToStderr).toBe(false);
  });
});

describe("PM.installDependencies when the run fails", () => {
  it("wraps the failure, keeping it as the cause", async ({ dir }) => {
    const cause = new Error("no such file");

    const error = await rejectionOf(() => {
      return PM.named("npm").installDependencies(
        {
          needed: true,
          dryRun: false,
          skipInstall: false,
        },
        {
          cwd: dir,
          env: {},
          task: async (_label, work) => {
            return work();
          },
          log,
          run: async () => {
            throw cause;
          },
        },
      );
    });

    expect(error).toBeInstanceOf(PmCommandFailedError);
    expect(error).toMatchObject({
      message: "npm install failed",
      cause,
    });
  });
});
