import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertDependencyFloor,
  assertInstalledFloor,
  dependencySpecProvablyBelow,
  dependencySpecProvablyBelowMajor,
  dependencyVersionMajor,
  hasDependency,
  installedVersion,
  readPackageJson,
  type PackageJson,
} from "../../../../../src/lib/orca/detectors/package-json";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-package-json-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readPackageJson", () => {
  it("reads and parses a valid package.json", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "14.0.0" } }),
    );
    const pkg = await readPackageJson(dir);
    expect(pkg.name).toBe("demo");
    expect(pkg.dependencies?.next).toBe("14.0.0");
  });

  it("rejects when package.json is missing", async () => {
    await expect(readPackageJson(dir)).rejects.toThrow();
  });

  it("rejects when package.json is malformed", async () => {
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

describe("dependencySpecProvablyBelowMajor", () => {
  function spec(value: string): PackageJson {
    return { dependencies: { next: value } };
  }

  it("rejects ranges that can only resolve below the floor", () => {
    // The upper-bound comparator is the case a first-digits parser inverts:
    // "<15" contains 15 as text yet admits only versions below it.
    for (const value of ["<15", "^14.2.0", "~14.5", "14.0.0", "14.x", ">=13 <15"]) {
      expect(dependencySpecProvablyBelowMajor(spec(value), "next", 15)).toBe(value);
    }
  });

  it("passes ranges that also admit a compliant version", () => {
    for (const value of [">=14", "14 || 16", "*", "^15.0.0", ">=15"]) {
      expect(dependencySpecProvablyBelowMajor(spec(value), "next", 15)).toBeUndefined();
    }
  });

  it("passes prereleases of the floor major", () => {
    expect(dependencySpecProvablyBelowMajor(spec("15.0.0-rc.0"), "next", 15)).toBeUndefined();
  });

  it("passes unprovable specs: protocols, dist-tags, git URLs, absence", () => {
    // A path like "file:../next-14-patched" carries digits but no provable
    // version — treating it as 14 would reject what cannot be judged.
    for (const value of [
      "file:../next-14-patched",
      "link:../next",
      "workspace:*",
      "latest",
      "canary",
      "github:vercel/next.js#canary",
    ]) {
      expect(dependencySpecProvablyBelowMajor(spec(value), "next", 15)).toBeUndefined();
    }
    expect(dependencySpecProvablyBelowMajor({}, "next", 15)).toBeUndefined();
  });

  it("reads devDependencies too", () => {
    expect(
      dependencySpecProvablyBelowMajor({ devDependencies: { next: "^14.0.0" } }, "next", 15),
    ).toBe("^14.0.0");
  });
});

describe("dependencySpecProvablyBelow", () => {
  function spec(value: string): PackageJson {
    return { dependencies: { "solid-js": value } };
  }

  it("rejects ranges that can only resolve below a minor floor", () => {
    for (const value of ["~1.7.0", "1.7.12", ">=1.6 <1.8"]) {
      expect(dependencySpecProvablyBelow(spec(value), "solid-js", "1.8")).toBe(value);
    }
  });

  it("passes ranges that reach the minor floor", () => {
    for (const value of ["^1.7.0", "^1", "^1.8.0", "1.8.0-beta.1", ">=1.6"]) {
      expect(dependencySpecProvablyBelow(spec(value), "solid-js", "1.8")).toBeUndefined();
    }
  });
});

describe("assertDependencyFloor", () => {
  const floor = { dependency: "nuxt", minimum: "4", product: "Nuxt", hint: "Upgrade." };

  it("refuses a provably older app with E_UNSUPPORTED_PROJECT_SHAPE", () => {
    expect(() => assertDependencyFloor({ dependencies: { nuxt: "^3.21.0" } }, floor)).toThrow(
      expect.objectContaining({ code: "E_UNSUPPORTED_PROJECT_SHAPE", hint: "Upgrade." }),
    );
  });

  it("names the spec and the floor", () => {
    expect(() => assertDependencyFloor({ dependencies: { nuxt: "^3.21.0" } }, floor)).toThrow(
      'Nuxt "^3.21.0" is below the supported floor — the CLI integrates Nuxt 4 and newer',
    );
  });

  it("passes a spec that may resolve to a supported version", () => {
    expect(() => assertDependencyFloor({ dependencies: { nuxt: "latest" } }, floor)).not.toThrow();
  });
});

/** Installs a package under `root`'s `node_modules` with the given manifest. */
async function install(root: string, name: string, manifest: string): Promise<void> {
  await mkdir(join(root, "node_modules", name), { recursive: true });
  await writeFile(join(root, "node_modules", name, "package.json"), manifest);
}

describe("installedVersion", () => {
  it("reads the version installed in the app's node_modules", async () => {
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.2.2" }));

    expect(await installedVersion(dir, "next")).toBe("15.2.2");
  });

  it("finds a version hoisted to a parent's node_modules", async () => {
    const app = join(dir, "apps", "web");
    await mkdir(app, { recursive: true });
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.1.7" }));

    expect(await installedVersion(app, "next")).toBe("15.1.7");
  });

  it("prefers the app's own install over a hoisted one", async () => {
    const app = join(dir, "apps", "web");
    await install(dir, "next", JSON.stringify({ name: "next", version: "15.1.7" }));
    await install(app, "next", JSON.stringify({ name: "next", version: "15.3.0" }));

    expect(await installedVersion(app, "next")).toBe("15.3.0");
  });

  it("reports nothing when the package is not installed", async () => {
    expect(await installedVersion(dir, "zitadel-not-installed-anywhere")).toBeUndefined();
  });

  it.each([
    ["no version", JSON.stringify({ name: "next" })],
    ["an invalid version", JSON.stringify({ name: "next", version: "fifteen" })],
    ["malformed JSON", "{"],
  ])("reports nothing for a manifest with %s", async (_case, manifest) => {
    await install(dir, "next", manifest);

    expect(await installedVersion(dir, "next")).toBeUndefined();
  });
});

describe("assertInstalledFloor", () => {
  const floor = { dependency: "next", minimum: "15.2.3", product: "Next.js", hint: "Upgrade." };

  it("refuses an installed version below the floor with E_UNSUPPORTED_PROJECT_SHAPE", async () => {
    await install(dir, "next", JSON.stringify({ version: "15.2.2" }));

    await expect(assertInstalledFloor(dir, floor)).rejects.toMatchObject({
      code: "E_UNSUPPORTED_PROJECT_SHAPE",
      hint: "Upgrade.",
    });
  });

  it("names the installed version and the floor", async () => {
    await install(dir, "next", JSON.stringify({ version: "15.2.2" }));

    await expect(assertInstalledFloor(dir, floor)).rejects.toThrow(
      "Next.js 15.2.2 is installed, below the supported floor — the CLI integrates Next.js 15.2.3 and newer",
    );
  });

  it.each(["15.2.3", "15.2.3-canary.1", "16.0.0"])("passes %s installed", async (version) => {
    await install(dir, "next", JSON.stringify({ version }));

    await expect(assertInstalledFloor(dir, floor)).resolves.toBeUndefined();
  });

  it("passes when nothing is installed", async () => {
    await expect(
      assertInstalledFloor(dir, { ...floor, dependency: "zitadel-not-installed-anywhere" }),
    ).resolves.toBeUndefined();
  });
});
