import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import semver from "semver";
import { describe, expect, it } from "vitest";

import type { FileOp } from "@/lib/orca/patchers/rule/file-writer/types";
import {
  PLAYWRIGHT_CONFIG,
  PLAYWRIGHT_PACKAGE,
  PLAYWRIGHT_RANGE,
  SIGN_IN_SPEC,
  supportsTestSuite,
  TEST_KIT_PACKAGE,
  testSuitePlan,
} from "@/lib/test-kit";
import { thrownBy } from "@tests/helpers/thrown-value";

/** The kit the suite is written against, as checked in beside the CLI. */
const KIT_ROOT = fileURLToPath(new URL("../../../../../packages/testing/", import.meta.url));

/** A version to pin the kit to. */
const KIT_VERSION = "1.2.3";

/** A plan for an app that declares nothing but Next.js. */
const NEXT_PLAN = testSuitePlan({
  framework: "next",
  kitVersion: KIT_VERSION,
  declared: new Set(["next"]),
});

/** The dev dependencies a plan adds, as `name@version`. */
function devDependencies(ops: ReadonlyArray<FileOp>): string[] {
  return ops.flatMap((op) => {
    return op.kind === "add-dep" && op.dev === true ? [`${op.name}@${op.version}`] : [];
  });
}

/** What a plan writes to `path`. */
function written(ops: ReadonlyArray<FileOp>, path: string): string {
  const op = ops.find((one) => {
    return one.kind === "write" && one.path === path;
  });
  return op?.kind === "write" ? op.contents : "";
}

/** The names a generated file imports from `module`. */
function importedFrom(source: string, module: string): string[] {
  const match = new RegExp(`import \\{([^}]*)\\} from "${module}"`).exec(source);
  return (match?.[1] ?? "").split(",").map((name) => {
    return name.trim();
  });
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
  it("pins the kit to the given version and adds Playwright as dev dependencies", () => {
    expect(devDependencies(NEXT_PLAN.ops)).toEqual([
      `${TEST_KIT_PACKAGE}@${KIT_VERSION}`,
      `${PLAYWRIGHT_PACKAGE}@${PLAYWRIGHT_RANGE}`,
    ]);
  });

  it("leaves a Playwright the app already declares as it is", () => {
    const plan = testSuitePlan({
      framework: "next",
      kitVersion: KIT_VERSION,
      declared: new Set(["next", PLAYWRIGHT_PACKAGE]),
    });

    expect(devDependencies(plan.ops)).toEqual([`${TEST_KIT_PACKAGE}@${KIT_VERSION}`]);
  });

  it("ignores the test run's outputs, the handshake file with the project secret among them", () => {
    expect(NEXT_PLAN.ops).toContainEqual({
      kind: "append-gitignore",
      entries: [".zitadel-testing/", "test-results/", "playwright-report/"],
    });
  });

  it("starts the Next.js dev server on the port the config serves the app on", () => {
    expect(written(NEXT_PLAN.ops, PLAYWRIGHT_CONFIG)).toContain(
      'command: ["npx", "next", "dev", "--hostname", "localhost", "--port", "3100"]',
    );
  });

  it("checks the sign-in lands on the profile page setup protects", () => {
    expect(written(NEXT_PLAN.ops, SIGN_IN_SPEC)).toContain(
      "await expect(page).toHaveURL(/\\/profile(?:[/?#]|$)/",
    );
  });

  it("refuses a framework it has no suite for", () => {
    const thrown = thrownBy(() => {
      return testSuitePlan({ framework: "react", kitVersion: KIT_VERSION, declared: new Set() });
    });

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ message: "no test suite for framework react" });
  });
});

describe("the generated suite against the kit", () => {
  it.each([PLAYWRIGHT_CONFIG, SIGN_IN_SPEC])(
    "%s imports only what the kit's Playwright entry exports",
    async (path) => {
      const entry = await readFile(`${KIT_ROOT}src/playwright.ts`, "utf8");

      const names = importedFrom(written(NEXT_PLAN.ops, path), `${TEST_KIT_PACKAGE}/playwright`);

      for (const name of names) {
        expect(entry, `${TEST_KIT_PACKAGE}/playwright exports ${name}`).toMatch(
          new RegExp(`export (?:const ${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`),
        );
      }
    },
  );

  it("installs a Playwright the kit accepts as its peer", async () => {
    const manifest = JSON.parse(await readFile(`${KIT_ROOT}package.json`, "utf8")) as {
      peerDependencies: Record<string, string>;
    };

    const floor = semver.minVersion(PLAYWRIGHT_RANGE);

    expect(
      floor !== null &&
        semver.satisfies(floor, manifest.peerDependencies[PLAYWRIGHT_PACKAGE] ?? ""),
    ).toBe(true);
  });
});
