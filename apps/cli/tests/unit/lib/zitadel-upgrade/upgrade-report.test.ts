import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { breakingChanges } from "@/lib/release-notes";
import { Release, ScopedDependencies, UpgradePlan } from "@/lib/upgrade";
import { UpgradeReport } from "@/lib/zitadel-upgrade";

const server = setupServer(
  http.get("https://api.github.com/repos/zitadel/nextgen/releases", () => {
    return HttpResponse.json([]);
  }),
);
const created: string[] = [];

async function aPlan(cliVersion: string, dependencies: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-upgrade-report-"));
  created.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
  return UpgradePlan.create({
    cliVersion,
    latest: new Release("2.0.0"),
    dependencies: await ScopedDependencies.read(dir, "@zitadel/"),
    changes: { breakingChanges },
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => {
      return rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("UpgradeReport.title", () => {
  it.each([
    ["2.0.0", { "@zitadel/api": "2.0.0" }, false, "Zitadel is up to date at 2.0.0"],
    ["2.0.0", { "@zitadel/api": "1.0.0" }, false, "Zitadel upgraded to 2.0.0"],
    ["2.0.0", { "@zitadel/api": "1.0.0" }, true, "Zitadel can be upgraded to 2.0.0 (dry run)"],
  ])("for CLI %s with %o, dry run %s, is %s", async (cli, dependencies, dryRun, title) => {
    const plan = await aPlan(cli, dependencies);

    const report = new UpgradeReport(plan, {
      refresh: "skipped",
      dryRun,
      installCommand: undefined,
    });

    expect(report.title).toBe(title);
  });
});

describe("UpgradeReport.rows", () => {
  it("names each package that moved and what would run on a dry run", async () => {
    const plan = await aPlan("2.0.0", { "@zitadel/api": "1.0.0" });

    const rows = new UpgradeReport(plan, {
      refresh: "planned",
      dryRun: true,
      installCommand: "npm install --save-exact @zitadel/api@2.0.0",
    }).rows();

    expect(rows.join("\n")).toContain("@zitadel/api 1.0.0 → 2.0.0");
    expect(rows.join("\n")).toContain("Would run");
  });

  it("spells out a package name that carries control characters", async () => {
    const plan = await aPlan("2.0.0", { "@zitadel/api\u001b[2Jwiped": "1.0.0" });

    const rows = new UpgradeReport(plan, {
      refresh: "skipped",
      dryRun: false,
      installCommand: undefined,
    }).rows();

    expect(rows.join("\n")).not.toContain("\u001b[2J");
  });

  it("says a range was left alone", async () => {
    const plan = await aPlan("2.0.0", { "@zitadel/api": "^1.0.0" });

    const rows = new UpgradeReport(plan, {
      refresh: "skipped",
      dryRun: false,
      installCommand: undefined,
    }).rows();

    expect(rows.join("\n")).toContain('@zitadel/api left at "^1.0.0", not an exact version');
  });

  it.each([
    ["done", "Refreshed generated files with doctor --fix"],
    ["issues", "doctor still reports issues"],
    ["failed", "Could not refresh generated files"],
  ] as const)("says how a refresh that %s ended", async (refresh, line) => {
    const plan = await aPlan("2.0.0", { "@zitadel/api": "1.0.0" });

    const rows = new UpgradeReport(plan, {
      refresh,
      dryRun: false,
      installCommand: undefined,
    }).rows();

    expect(rows.join("\n")).toContain(line);
  });
});

describe("UpgradeReport.data", () => {
  it("carries the envelope's keys, with dry_run and install_command only when they apply", async () => {
    const plan = await aPlan("2.0.0", { "@zitadel/api": "1.0.0" });

    const live = new UpgradeReport(plan, {
      refresh: "done",
      dryRun: false,
      installCommand: undefined,
    }).data();
    const dry = new UpgradeReport(plan, {
      refresh: "planned",
      dryRun: true,
      installCommand: "npm install @zitadel/api@2.0.0",
    }).data();

    expect(Object.keys(live).sort()).toEqual(
      [
        "breaking_changes",
        "current_version",
        "latest_version",
        "left_alone",
        "packages",
        "refresh",
        "release_notes_url",
        "title",
        "up_to_date",
      ].sort(),
    );
    expect([dry.dry_run, dry.install_command]).toEqual([true, "npm install @zitadel/api@2.0.0"]);
  });
});
