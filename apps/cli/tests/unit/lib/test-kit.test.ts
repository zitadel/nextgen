import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import semver from "semver";
import { describe, expect, it } from "vitest";

import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import { sdkVersionForCli } from "@/lib/public-cli";
import {
  PLAYWRIGHT_PACKAGE,
  PLAYWRIGHT_RANGE,
  supportsTestSuite,
  TEST_KIT_PACKAGE,
  testSuitePlan,
} from "@/lib/test-kit";
import { thrownBy } from "@tests/helpers/thrown-value";

/** The kit's manifest, as checked in beside the CLI. */
const KIT_MANIFEST = fileURLToPath(
  new URL("../../../../../packages/testing/package.json", import.meta.url),
);

/** A CLI version to pin the kit by. */
const CLI_VERSION = "1.2.3";

/** A plan for an app that declares nothing but Next.js and a dev script. */
const NEXT_PLAN = testSuitePlan({
  framework: "next",
  cliVersion: CLI_VERSION,
  declared: new Set(["next"]),
  scripts: new Set(["dev"]),
});

/** The dev dependencies a plan adds, as `name@version`. */
function devDependencies(ops: ReadonlyArray<FileOp>): string[] {
  return ops.flatMap((op) => {
    return op.kind === "add-dep" && op.dev === true ? [`${op.name}@${op.version}`] : [];
  });
}

/** The plan's edit of `package.json`, or one that changes nothing. */
function scriptEdit(ops: ReadonlyArray<FileOp>): (source: string) => string {
  const op = ops.find((one) => {
    return one.kind === "edit" && one.path === "package.json";
  });
  return op?.kind === "edit" ? op.edit : (source) => source;
}

describe("supportsTestSuite", () => {
  it.each([
    ["next", true],
    ["react", false],
    ["nuxt", false],
  ])("answers %s with %s", (framework, supported) => {
    expect(supportsTestSuite(framework)).toBe(supported);
  });
});

describe("testSuitePlan", () => {
  it("pins the kit as setup pins the SDK, and adds Playwright", () => {
    expect(devDependencies(NEXT_PLAN.ops)).toEqual([
      `${TEST_KIT_PACKAGE}@${sdkVersionForCli(CLI_VERSION)}`,
      `${PLAYWRIGHT_PACKAGE}@${PLAYWRIGHT_RANGE}`,
    ]);
  });

  it("leaves a Playwright the app already declares as it is", () => {
    const plan = testSuitePlan({
      framework: "next",
      cliVersion: CLI_VERSION,
      declared: new Set(["next", PLAYWRIGHT_PACKAGE]),
      scripts: new Set(),
    });

    expect(devDependencies(plan.ops)).toEqual([
      `${TEST_KIT_PACKAGE}@${sdkVersionForCli(CLI_VERSION)}`,
    ]);
  });

  it("ignores the test run's outputs, the handshake file with the project secret among them", () => {
    expect(NEXT_PLAN.ops).toContainEqual({
      kind: "append-gitignore",
      entries: [".zitadel-testing/", "test-results/", "playwright-report/"],
    });
  });

  it.each([
    [
      '{\n  "name": "app"\n}\n',
      '{\n  "name": "app",\n  "scripts": {\n    "test:e2e": "playwright test"\n  }\n}\n',
    ],
    [
      '{"name":"app","scripts":{"dev":"next dev"}}',
      '{"name":"app","scripts":{"dev":"next dev","test:e2e":"playwright test"}}',
    ],
  ])("adds the test:e2e script to %j and leaves the rest as it is", (before, after) => {
    expect(scriptEdit(NEXT_PLAN.ops)(before)).toBe(after);
  });

  it("adds no script when the app already has a test:e2e", () => {
    const plan = testSuitePlan({
      framework: "next",
      cliVersion: CLI_VERSION,
      declared: new Set(),
      scripts: new Set(["test:e2e"]),
    });

    expect(
      plan.ops.filter((op) => {
        return op.kind === "edit";
      }),
    ).toEqual([]);
  });

  it("refuses a framework it has no suite for", () => {
    const thrown = thrownBy(() => {
      return testSuitePlan({
        framework: "react",
        cliVersion: CLI_VERSION,
        declared: new Set(),
        scripts: new Set(),
      });
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ message: "no test suite for framework react" });
  });

  it("installs a Playwright the kit accepts as its peer", async () => {
    const manifest = JSON.parse(await readFile(KIT_MANIFEST, "utf8")) as {
      peerDependencies: Record<string, string>;
    };

    const floor = semver.minVersion(PLAYWRIGHT_RANGE);

    expect(
      floor !== null &&
        semver.satisfies(floor, manifest.peerDependencies[PLAYWRIGHT_PACKAGE] ?? ""),
    ).toBe(true);
  });
});
