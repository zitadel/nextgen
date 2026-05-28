import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectFramework } from "../../../src/detect/framework";
import { ZitadelError } from "../../../src/lib/errors";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-framework-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeNextPackageJson(): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "14.0.0" } }),
  );
}

describe("detectFramework", () => {
  it("detects a Next.js project with a top-level app/ directory", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "app"));
    expect(await detectFramework(dir)).toEqual({ id: "next", appDir: "app" });
  });

  it("detects a Next.js project with a src/app/ directory", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detectFramework(dir)).toEqual({ id: "next", appDir: "src/app" });
  });

  it("prefers top-level app/ over src/app/ when both exist", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "app"));
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detectFramework(dir)).toEqual({ id: "next", appDir: "app" });
  });

  it("recognizes next as a devDependency", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { next: "14.0.0" } }),
    );
    await mkdir(join(dir, "app"));
    expect(await detectFramework(dir)).toEqual({ id: "next", appDir: "app" });
  });

  it("throws E_FRAMEWORK_NOT_DETECTED for an explicitly unsupported framework", async () => {
    let caught: unknown;
    try {
      await detectFramework(dir, "remix");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_FRAMEWORK_NOT_DETECTED");
  });

  it("accepts an explicit requested framework of next", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "app"));
    expect(await detectFramework(dir, "next")).toEqual({ id: "next", appDir: "app" });
  });

  it("throws E_FRAMEWORK_NOT_DETECTED when package.json is missing", async () => {
    let caught: unknown;
    try {
      await detectFramework(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_FRAMEWORK_NOT_DETECTED");
  });

  it("throws E_FRAMEWORK_NOT_DETECTED when next is not a dependency", async () => {
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { react: "18.0.0" } }),
    );
    await mkdir(join(dir, "app"));
    let caught: unknown;
    try {
      await detectFramework(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_FRAMEWORK_NOT_DETECTED");
  });

  it("throws E_UNSUPPORTED_PROJECT_SHAPE when no app router directory exists", async () => {
    await writeNextPackageJson();
    let caught: unknown;
    try {
      await detectFramework(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
  });
});
