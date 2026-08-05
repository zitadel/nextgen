import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NextDetector } from "../../../../../src/lib/orca/detectors/next";
import { ZitadelError } from "../../../../../src/lib/errors";

const detector = new NextDetector();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-next-detector-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeNextPackageJson(extra: Record<string, unknown> = {}): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "15.0.0" }, ...extra }),
  );
}

describe("NextDetector", () => {
  it("declares the next framework id", () => {
    expect(detector.framework).toBe("next");
  });

  it("detects a top-level app/ project with default port and issuer", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toEqual({
      id: "next",
      appDir: "app",
      devPort: 3000,
      url: "http://localhost:3000",
      versionMajor: 15,
    });
  });

  it("detects a src/app/ project", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detector.detect(dir)).toMatchObject({ id: "next", appDir: "src/app" });
  });

  it("prefers top-level app/ over src/app/ when both exist", async () => {
    await writeNextPackageJson();
    await mkdir(join(dir, "app"));
    await mkdir(join(dir, "src", "app"), { recursive: true });
    expect(await detector.detect(dir)).toMatchObject({ appDir: "app" });
  });

  it("recognizes next as a devDependency", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ devDependencies: { next: "15.0.0" } }));
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
  });

  it("captures the Next major version for scaffold decisions", async () => {
    await writeNextPackageJson({ dependencies: { next: "^16.2.4" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ versionMajor: 16 });
  });

  it("extracts the dev-script port into devPort and url", async () => {
    await writeNextPackageJson({ scripts: { dev: "next dev -p 4567" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({
      devPort: 4567,
      url: "http://localhost:4567",
    });
  });

  it("returns null when package.json is missing", async () => {
    expect(await detector.detect(dir)).toBeNull();
  });

  it("returns null when next is not a dependency", async () => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { react: "18.0.0" } }));
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toBeNull();
  });

  it("throws E_UNSUPPORTED_PROJECT_SHAPE for a Next project with no app router", async () => {
    await writeNextPackageJson();
    let caught: unknown;
    try {
      await detector.detect(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("Pages Router");
  });

  it("throws the version floor for Next 14, before the app-router shape check", async () => {
    // No app/ dir on purpose: the floor is the more fundamental cut, so the
    // user is not told to restructure to the App Router only to then hit
    // the version wall (ADR 043).
    await writeNextPackageJson({ dependencies: { next: "^14.2.0" } });
    let caught: unknown;
    try {
      await detector.detect(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ZitadelError);
    expect((caught as ZitadelError).code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect((caught as ZitadelError).message).toContain("below the supported floor");
  });

  it("lets an unparseable next version through the floor", async () => {
    // "latest" carries no provable major; blocking on it would be hostile.
    await writeNextPackageJson({ dependencies: { next: "latest" } });
    await mkdir(join(dir, "app"));
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
    expect(await detector.detect(dir)).not.toHaveProperty("versionMajor");
  });

  it("judges the floor by range semantics, not by digits in the spec", async () => {
    await mkdir(join(dir, "app"));
    // "<15" contains the digits 15 yet admits only versions below the floor.
    await writeNextPackageJson({ dependencies: { next: "<15" } });
    await expect(detector.detect(dir)).rejects.toThrow("below the supported floor");
    // A path spec carries digits but no provable version — it must pass.
    await writeNextPackageJson({ dependencies: { next: "file:../next-14-patched" } });
    expect(await detector.detect(dir)).toMatchObject({ id: "next" });
  });
});
