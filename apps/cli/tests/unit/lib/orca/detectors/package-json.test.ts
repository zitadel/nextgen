import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dependencySpecProvablyBelowMajor,
  dependencyVersionMajor,
  hasDependency,
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
