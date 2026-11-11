import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { NextDetector } from "@/lib/orca/detectors/next";
import { ZitadelError } from "@/lib/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

const detector = new NextDetector();

async function writeNextPackageJson(
  dir: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "15.2.3" }, ...extra }),
  );
}

/** Installs Next.js at `version` in the app's `node_modules`. */
async function installNext(dir: string, version: string): Promise<void> {
  await mkdir(join(dir, "node_modules", "next"), { recursive: true });
  await writeFile(
    join(dir, "node_modules", "next", "package.json"),
    JSON.stringify({ name: "next", version }),
  );
}

describe("NextDetector", () => {
  it("declares the next framework id", () => {
    expect(detector.framework).toBe("next");
  });

  it("detects a top-level app/ project with default port and issuer", async ({ dir }) => {
    await writeNextPackageJson(dir);
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toEqual({
      id: "next",
      appDir: "app",
      devPort: 3000,
      url: "http://localhost:3000",
      versionMajor: 15,
    });
  });

  it("detects a src/app/ project", async ({ dir }) => {
    await writeNextPackageJson(dir);
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detector.detect(dir)).toMatchObject({ id: "next", appDir: "src/app" });
  });

  it("prefers top-level app/ over src/app/ when both exist", async ({ dir }) => {
    await writeNextPackageJson(dir);
    await mkdir(join(dir, "app"));
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detector.detect(dir)).toMatchObject({ appDir: "app" });
  });

  it("recognizes next as a devDependency", async ({ dir }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { next: "15.2.3" } }),
    );
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
  });

  it("captures the Next major version for scaffold decisions", async ({ dir }) => {
    await writeNextPackageJson(dir, { dependencies: { next: "^16.2.4" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ versionMajor: 16 });
  });

  it("extracts the dev-script port into devPort and url", async ({ dir }) => {
    await writeNextPackageJson(dir, { scripts: { dev: "next dev -p 4567" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({
      devPort: 4567,
      url: "http://localhost:4567",
    });
  });

  it("returns null when package.json is missing", async ({ dir }) => {
    expect(await detector.detect(dir)).toBeNull();
  });

  it("returns null when next is not a dependency", async ({ dir }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "18.0.0" } }),
    );
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toBeNull();
  });

  it("throws E_UNSUPPORTED_PROJECT_SHAPE for a Next project with no app router", async ({
    dir,
  }) => {
    await writeNextPackageJson(dir);
    const caught = await rejectionOf(() => detector.detect(dir));
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("Pages Router");
  });

  it("throws the version floor for Next 14, before the app-router shape check", async ({ dir }) => {
    // No app/ dir on purpose: the floor is the more fundamental cut, so the
    // user is not told to restructure to the App Router only to then hit
    // the version wall (ADR 043).
    await writeNextPackageJson(dir, { dependencies: { next: "^14.2.0" } });
    const caught = await rejectionOf(() => detector.detect(dir));
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("below the supported floor");
  });

  it.for(["15.2.2", "~15.1.0", "15.1.7"])(
    "refuses next %s, which skips middleware for a forged subrequest header",
    async (spec, { dir }) => {
      await mkdir(join(dir, "app"));
      await writeNextPackageJson(dir, { dependencies: { next: spec } });

      await expect(detector.detect(dir)).rejects.toThrow(
        `Next.js "${spec}" is below the supported floor — the CLI integrates Next.js 15.2.3 and newer`,
      );
    },
  );

  it("points a refused Next 15 app at the release that fixes the middleware bypass", async ({
    dir,
  }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: "15.2.2" } });

    await expect(detector.detect(dir)).rejects.toMatchObject({
      hint: expect.stringContaining("CVE-2025-29927"),
    });
  });

  // A range that can resolve to a fixed release passes: the gate refuses only
  // a spec that provably cannot, so `^15.0.0` is accepted.
  it.for(["15.2.3", "^15.2.3", "^15.0.0", "16.0.0"])("accepts next %s", async (spec, { dir }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: spec } });

    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
  });

  it.for<[string, string]>([
    ["^15.0.0", "15.2.2"],
    ["^15.1.0", "15.1.7"],
    ["latest", "15.0.0"],
  ])(
    "refuses next %s with %s installed, which skips middleware for a forged subrequest header",
    async ([spec, installed], { dir }) => {
      await mkdir(join(dir, "app"));
      await writeNextPackageJson(dir, { dependencies: { next: spec } });
      await installNext(dir, installed);

      await expect(detector.detect(dir)).rejects.toThrow(
        new RegExp(
          `^Next\\.js ${installed.replaceAll(".", "\\.")} is installed \\(.*node_modules/next/package\\.json\\), below the supported floor — the CLI integrates Next\\.js 15\\.2\\.3 and newer$`,
        ),
      );
    },
  );

  it("points an app with a vulnerable Next installed at the release that fixes it", async ({
    dir,
  }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: "^15.0.0" } });
    await installNext(dir, "15.2.2");

    await expect(detector.detect(dir)).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      hint: expect.stringContaining("Upgrade the app to Next.js 15.2.3 or later"),
    });
  });

  it("names the package.json it read, so a stale install above the app is traceable", async ({
    dir,
  }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: "^15.2.3" } });
    await installNext(dir, "15.2.2");

    await expect(detector.detect(dir)).rejects.toThrow(
      `${join("node_modules", "next", "package.json")}), below the supported floor`,
    );
  });

  it("does not judge an app by a next installed above its workspace root", async ({ dir }) => {
    const root = join(dir, "repo");
    const app = join(root, "apps", "web");
    await mkdir(join(app, "app"), { recursive: true });
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ name: "web", dependencies: { next: "^15.2.3" } }),
    );
    await mkdir(join(dir, "node_modules", "next"), { recursive: true });
    await writeFile(
      join(dir, "node_modules", "next", "package.json"),
      JSON.stringify({ name: "next", version: "15.0.0" }),
    );

    expect(await detector.detect(app)).toMatchObject({ id: "next" });
  });

  it.for(["15.2.3", "15.5.4", "16.0.0"])(
    "accepts next ^15.0.0 with %s installed",
    async (installed, { dir }) => {
      await mkdir(join(dir, "app"));
      await writeNextPackageJson(dir, { dependencies: { next: "^15.0.0" } });
      await installNext(dir, installed);

      expect(await detector.detect(dir)).toMatchObject({ id: "next" });
    },
  );

  it("refuses the pinned canary of the fixed patch, which predates the fix", async ({ dir }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: "15.2.3-canary.0" } });

    await expect(detector.detect(dir)).rejects.toThrow("below the supported floor");
  });

  it("refuses a canary of the fixed patch installed under an accepting range", async ({ dir }) => {
    await mkdir(join(dir, "app"));
    await writeNextPackageJson(dir, { dependencies: { next: "^15.0.0" } });
    await installNext(dir, "15.2.3-canary.0");

    await expect(detector.detect(dir)).rejects.toThrow("15.2.3-canary.0 is installed");
  });

  it.for(["15.3.0-canary.1", "16.0.0-rc.1"])(
    "accepts the pinned prerelease %s, newer than the floor",
    async (version, { dir }) => {
      await mkdir(join(dir, "app"));
      await writeNextPackageJson(dir, { dependencies: { next: version } });
      expect(await detector.detect(dir)).toMatchObject({ id: "next" });
    },
  );

  it("lets an unparseable next version through the floor", async ({ dir }) => {
    // "latest" carries no provable major; blocking on it would be hostile.
    await writeNextPackageJson(dir, { dependencies: { next: "latest" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
    expect(await detector.detect(dir)).not.toHaveProperty("versionMajor");
  });

  it("judges the floor by range semantics, not by digits in the spec", async ({ dir }) => {
    await mkdir(join(dir, "app"));
    // "<15" contains the digits 15 yet admits only versions below the floor.
    await writeNextPackageJson(dir, { dependencies: { next: "<15" } });
    await expect(detector.detect(dir)).rejects.toThrow("below the supported floor");
    // A path spec carries digits but no provable version — it must pass.
    await writeNextPackageJson(dir, { dependencies: { next: "file:../next-14-patched" } });
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
  });
});
