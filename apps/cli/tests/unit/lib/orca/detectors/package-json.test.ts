import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import {
  dependencySpecProvablyBelow,
  dependencyVersionMajor,
  hasDependency,
  installedVersion,
  installedVersionBelow,
  readPackageJson,
  type PackageJson,
} from "@/lib/orca/detectors/package-json";

describe("readPackageJson", () => {
  it("reads and parses a valid package.json", async ({ dir }) => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "14.0.0" } }),
    );
    const pkg = await readPackageJson(dir);
    expect(pkg.name).toBe("demo");
    expect(pkg.dependencies?.next).toBe("14.0.0");
  });

  it("rejects when package.json is missing", async ({ dir }) => {
    await expect(readPackageJson(dir)).rejects.toThrow();
  });

  it("rejects when package.json is malformed", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{not json");
    await expect(readPackageJson(dir)).rejects.toThrow();
  });
});

describe("hasDependency", () => {
  it("returns true when the name is in dependencies", () => {
    const pkg: PackageJson = { dependencies: { next: "14.0.0" } };
    expect(hasDependency(pkg, "next")).toBe(true);
  });

  it("returns true when the name is in devDependencies", () => {
    const pkg: PackageJson = { devDependencies: { next: "14.0.0" } };
    expect(hasDependency(pkg, "next")).toBe(true);
  });

  it("returns false when the name is absent from both", () => {
    const pkg: PackageJson = { dependencies: { react: "18.0.0" } };
    expect(hasDependency(pkg, "next")).toBe(false);
  });

  it("returns false when there are no dependency maps at all", () => {
    expect(hasDependency({}, "next")).toBe(false);
  });
});

describe("dependencyVersionMajor", () => {
  it("extracts the first numeric major from a dependency spec", () => {
    expect(dependencyVersionMajor({ dependencies: { next: "^16.2.4" } }, "next")).toBe(16);
    expect(dependencyVersionMajor({ devDependencies: { next: "~15.5.0" } }, "next")).toBe(15);
    expect(dependencyVersionMajor({ dependencies: { next: "canary" } }, "next")).toBeUndefined();
  });
});

describe("dependencySpecProvablyBelow", () => {
  const pkg = (next: string): PackageJson => ({ dependencies: { next } });

  it("rejects ranges that can only resolve below a patch-level floor", () => {
    expect(dependencySpecProvablyBelow(pkg("15.2.2"), "next", "15.2.3")).toBe("15.2.2");
    expect(dependencySpecProvablyBelow(pkg("~15.1.0"), "next", "15.2.3")).toBe("~15.1.0");
  });

  it("rejects an upper bound at the floor, which resolves no prerelease of it", () => {
    expect(dependencySpecProvablyBelow(pkg("<15.2.3"), "next", "15.2.3")).toBe("<15.2.3");
  });

  it("rejects a pinned prerelease of a patch-level floor, which predates the fix", () => {
    expect(dependencySpecProvablyBelow(pkg("15.2.3-canary.1"), "next", "15.2.3")).toBe(
      "15.2.3-canary.1",
    );
  });

  it("passes a range naming a prerelease of the floor that also admits the release", () => {
    expect(dependencySpecProvablyBelow(pkg("^15.2.3-canary.1"), "next", "15.2.3")).toBeUndefined();
  });

  it("passes a pinned prerelease newer than the floor", () => {
    expect(dependencySpecProvablyBelow(pkg("15.3.0-canary.1"), "next", "15.2.3")).toBeUndefined();
    expect(dependencySpecProvablyBelow(pkg("16.0.0-rc.1"), "next", "15.2.3")).toBeUndefined();
  });

  it("rejects a pinned prerelease of a version below the floor", () => {
    expect(dependencySpecProvablyBelow(pkg("15.2.2-canary.1"), "next", "15.2.3")).toBe(
      "15.2.2-canary.1",
    );
  });

  it("passes a range whose strict bounds still admit a prerelease of a major-only floor", () => {
    expect(dependencySpecProvablyBelow(pkg(">15.0.0-rc.1 <15.0.0"), "next", "15")).toBeUndefined();
    expect(dependencySpecProvablyBelow(pkg(">=14 <15.0.0-rc.5"), "next", "15")).toBeUndefined();
  });

  it("rejects a range that admits only prereleases of a patch-level floor", () => {
    expect(dependencySpecProvablyBelow(pkg(">15.2.3-canary.1 <15.2.3"), "next", "15.2.3")).toBe(
      ">15.2.3-canary.1 <15.2.3",
    );
    expect(dependencySpecProvablyBelow(pkg(">=14 <15.2.3-canary.5"), "next", "15.2.3")).toBe(
      ">=14 <15.2.3-canary.5",
    );
  });

  it("rejects a range naming a prerelease of the floor that it cannot admit", () => {
    expect(
      dependencySpecProvablyBelow(pkg(">15.2.3-canary.1 <15.2.3-canary.1"), "next", "15.2.3"),
    ).toBe(">15.2.3-canary.1 <15.2.3-canary.1");
    expect(dependencySpecProvablyBelow(pkg("<15"), "next", "15.2.3")).toBe("<15");
  });

  it("passes ranges that also admit the floor or newer", () => {
    expect(dependencySpecProvablyBelow(pkg("^15.0.0"), "next", "15.2.3")).toBeUndefined();
    expect(dependencySpecProvablyBelow(pkg("15.2.3"), "next", "15.2.3")).toBeUndefined();
  });

  it("passes unprovable specs: dist-tags and absence", () => {
    expect(dependencySpecProvablyBelow(pkg("latest"), "next", "15.2.3")).toBeUndefined();
    expect(dependencySpecProvablyBelow({}, "next", "15.2.3")).toBeUndefined();
  });
});

describe("a prerelease floor", () => {
  const pkg = (spec: string): PackageJson => ({ dependencies: { qwik: spec } });

  it.each(["2.0.0-beta.1", "2.0.0-beta.44", "<2.0.0-beta.45", ">=2.0.0-beta.1 <2.0.0-beta.30"])(
    "rejects %s, which cannot reach the floor",
    (spec) => {
      expect(dependencySpecProvablyBelow(pkg(spec), "qwik", "2.0.0-beta.45")).toBe(spec);
    },
  );

  it.each(["<2.0.0", "~1.9.0", "<2.0.0-beta.45", ">=1.0.0 <2.0.0"])(
    "rejects %s for a prerelease floor, since npm admits no beta from it",
    (spec) => {
      expect(dependencySpecProvablyBelow(pkg(spec), "qwik", "2.0.0-beta.45")).toBe(spec);
    },
  );

  it.each([">=2.0.0-beta.50 <2.0.0", ">=2.0.0-beta.1", "2.0.0-beta.45 || <1.0.0"])(
    "accepts %s for a prerelease floor, since it names an allowed beta",
    (spec) => {
      expect(dependencySpecProvablyBelow(pkg(spec), "qwik", "2.0.0-beta.45")).toBeUndefined();
    },
  );

  it.each(["2.0.0-beta.45", "2.0.0-beta.50", "^2.0.0-beta.1", "2.0.0-rc.0", "^2.0.0", "3.0.0"])(
    "passes %s",
    (spec) => {
      expect(dependencySpecProvablyBelow(pkg(spec), "qwik", "2.0.0-beta.45")).toBeUndefined();
    },
  );
});

/** Installs a package under `root`'s `node_modules` with the given manifest. */
async function install(root: string, name: string, manifest: string): Promise<void> {
  await mkdir(join(root, "node_modules", name), { recursive: true });
  await writeFile(join(root, "node_modules", name, "package.json"), manifest);
}

describe("installedVersion", () => {
  it("reads the version installed in the app's node_modules", async ({ dir }) => {
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.2.2" }));

    expect(await installedVersion(dir, "next")).toBe("15.2.2");
  });

  it("finds a version hoisted to a parent's node_modules", async ({ dir }) => {
    const app = join(dir, "apps", "web");
    await mkdir(app, { recursive: true });
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.1.7" }));

    expect(await installedVersion(app, "next")).toBe("15.1.7");
  });

  it("walks the real parents of a symlinked app directory", async ({ dir }) => {
    const workspace = join(dir, "workspace");
    const app = join(workspace, "apps", "web");
    await mkdir(app, { recursive: true });
    await install(workspace, "next", JSON.stringify({ name: "next", version: "15.2.2" }));
    const link = join(dir, "link");
    await symlink(app, link);

    expect(await installedVersion(link, "next")).toBe("15.2.2");
  });

  it("prefers the app's own install over a hoisted one", async ({ dir }) => {
    const app = join(dir, "apps", "web");
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.1.7" }));
    await install(app, "next", JSON.stringify({ name: "next", version: "15.3.0" }));

    expect(await installedVersion(app, "next")).toBe("15.3.0");
  });

  it("reports nothing when the package is not installed", async ({ dir }) => {
    expect(await installedVersion(dir, "zitadel-not-installed-anywhere")).toBeUndefined();
  });

  it("does not look above a pnpm workspace root", async ({ dir }) => {
    const root = join(dir, "repo");
    const app = join(root, "apps", "web");
    await mkdir(app, { recursive: true });
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.0.0" }));

    expect(await installedVersion(app, "next")).toBeUndefined();
  });

  it("does not look above a package.json workspaces root", async ({ dir }) => {
    const root = join(dir, "repo");
    const app = join(root, "apps", "web");
    await mkdir(app, { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.0.0" }));

    expect(await installedVersion(app, "next")).toBeUndefined();
  });

  it("still finds a version hoisted to the workspace root itself", async ({ dir }) => {
    const root = join(dir, "repo");
    const app = join(root, "apps", "web");
    await mkdir(app, { recursive: true });
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    await install(root, "next", JSON.stringify({ name: "next", version: "15.1.7" }));

    expect(await installedVersion(app, "next")).toBe("15.1.7");
  });

  it.for<[string, string]>([
    ["no version", JSON.stringify({ name: "next" })],
    ["an invalid version", JSON.stringify({ name: "next", version: "fifteen" })],
    ["malformed JSON", "{"],
  ])("reports nothing for a manifest with %s", async ([_case, manifest], { dir }) => {
    await install(dir, "next", manifest);

    expect(await installedVersion(dir, "next")).toBeUndefined();
  });
});

describe("installedVersionBelow", () => {
  it("returns an installed version below the minimum with the manifest it read", async ({
    dir,
  }) => {
    await install(dir, "next", JSON.stringify({ version: "15.2.2" }));

    expect(await installedVersionBelow(dir, "next", "15.2.3")).toEqual({
      version: "15.2.2",
      path: join(await realpath(dir), "node_modules", "next", "package.json"),
    });
  });

  it("returns a prerelease of a patch-level minimum, which predates the release", async ({
    dir,
  }) => {
    await install(dir, "next", JSON.stringify({ version: "15.2.3-canary.1" }));

    expect(await installedVersionBelow(dir, "next", "15.2.3")).toMatchObject({
      version: "15.2.3-canary.1",
    });
  });

  it("passes a prerelease of a major-only minimum as at-floor", async ({ dir }) => {
    await install(dir, "react", JSON.stringify({ version: "18.0.0-rc.0" }));

    expect(await installedVersionBelow(dir, "react", "18")).toBeUndefined();
  });

  it.for(["15.2.3", "15.3.0-canary.1", "16.0.0"])(
    "passes %s installed",
    async (version, { dir }) => {
      await install(dir, "next", JSON.stringify({ version }));

      expect(await installedVersionBelow(dir, "next", "15.2.3")).toBeUndefined();
    },
  );

  it("judges an installed beta against a prerelease minimum as written", async ({ dir }) => {
    await install(dir, "qwik", JSON.stringify({ version: "2.0.0-beta.12" }));
    expect(await installedVersionBelow(dir, "qwik", "2.0.0-beta.45")).toMatchObject({
      version: "2.0.0-beta.12",
    });

    await install(dir, "qwik", JSON.stringify({ version: "2.0.0-beta.45" }));
    expect(await installedVersionBelow(dir, "qwik", "2.0.0-beta.45")).toBeUndefined();
  });

  it("passes when nothing is installed", async ({ dir }) => {
    expect(
      await installedVersionBelow(dir, "zitadel-not-installed-anywhere", "15.2.3"),
    ).toBeUndefined();
  });
});
