import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SANITY_CHECKS, type CheckOutcome } from "../../../../src/commands/doctor/checks";
import {
  categoryOf,
  CHECK_CATEGORIES,
  renderDoctorReport,
  withCategories,
  type DoctorReportInput,
} from "../../../../src/commands/doctor/report";

function report(checks: CheckOutcome[], input: Partial<DoctorReportInput> = {}): string {
  return renderDoctorReport({
    checks,
    cliVersion: "1.0.0",
    projectConfigured: true,
    runtime: "binary",
    port: 8080,
    next: {},
    verbose: false,
    ...input,
  });
}

const pass = (name: string, message = `${name} ok`): CheckOutcome => ({
  name,
  status: "pass",
  message,
});

describe("categories", () => {
  it("files every check the command registers", () => {
    const filed = CHECK_CATEGORIES.flatMap((category) => category.checks);

    for (const check of SANITY_CHECKS) {
      expect(filed, check.name).toContain(check.name);
    }
  });

  it("files every check the command builds itself", async () => {
    const source = await readFile(
      join(import.meta.dirname, "../../../../src/commands/doctor/index.ts"),
      "utf8",
    );
    const built = [
      ...source.matchAll(/(?:await check\(\s*|check\(\s*|name: )"([a-z-]+)"/g),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
    const filed = CHECK_CATEGORIES.flatMap((category) => category.checks);

    expect(built.length).toBeGreaterThan(0);
    for (const name of built) {
      expect(filed, name).toContain(name);
    }
  });

  it("files a check under one category only", () => {
    const filed = CHECK_CATEGORIES.flatMap((category) => category.checks);

    expect(new Set(filed).size).toBe(filed.length);
  });

  it("puts the category on the checks the envelope carries", () => {
    expect(withCategories([pass("port")])).toEqual([
      { name: "port", status: "pass", message: "port ok", category: "local_server" },
    ]);
    expect(categoryOf("secret")).toBe("credentials");
  });
});

describe("renderDoctorReport", () => {
  it("collapses a category whose checks all passed", () => {
    const text = report([pass("config"), pass("schema")]);

    expect(text).toContain("[✓] Project");
    expect(text).toContain("2 checks passed");
    expect(text).not.toContain("config ok");
    expect(text).toContain("✓ Zitadel doctor passed.");
  });

  it("lists what needs attention under its category", () => {
    const text = report([
      pass("config"),
      { name: "schema", status: "warn", message: "No schema files" },
    ]);

    expect(text).toContain("[!] Project");
    expect(text).toContain("    ! No schema files");
    expect(text).not.toContain("config ok");
    expect(text).toContain("! Zitadel doctor passed with warnings in 1 category.");
  });

  it("marks a category by the worst of its checks", () => {
    const text = report([
      { name: "framework", status: "warn", message: "a warning" },
      { name: "dependency", status: "fail", message: "a failure" },
      { name: "secret", status: "fail", message: "another" },
    ]);

    expect(text).toContain("[✗] App integration");
    expect(text).toContain("✗ Zitadel doctor found issues in 2 categories.");
  });

  it("says a cause several checks share once", () => {
    const missing = ".zitadel/secret was not found";
    const text = report([
      { name: "secret", status: "fail", message: missing },
      { name: "secret-permissions", status: "fail", message: missing },
      { name: "project-match", status: "fail", message: missing },
    ]);

    expect(text.split(missing)).toHaveLength(2);
  });

  it("expands every check with --verbose, by name", () => {
    const text = report([pass("config")], { verbose: true });

    expect(text).toContain("✓ config: config ok");
    expect(text).not.toContain("Run with -v");
  });

  it("names every check that shares a cause with --verbose", () => {
    const missing = ".zitadel/secret was not found";
    const text = report(
      [
        { name: "secret", status: "fail", message: missing },
        { name: "project-match", status: "fail", message: missing },
      ],
      { verbose: true },
    );

    expect(text).toContain(`secret: ${missing}`);
    expect(text).toContain(`project-match: ${missing}`);
  });

  it("orders the categories whatever order the checks ran in", () => {
    const text = report([pass("config"), pass("port"), pass("cli-version")]);

    expect(text.indexOf("Versions")).toBeLessThan(text.indexOf("Local server"));
    expect(text.indexOf("Local server")).toBeLessThan(text.indexOf("Project"));
  });

  it("shows the CLI's version, and the newer one when there is one", () => {
    expect(report([pass("cli-version")])).toContain("CLI 1.0.0");
    expect(
      report([
        {
          name: "cli-version",
          status: "warn",
          message: "behind",
          details: { latest: "2.0.0", remedy_command: "npx @zitadel/cli@latest upgrade" },
        },
      ]),
    ).toContain("CLI 1.0.0, 2.0.0 available");
  });

  it("pulls out the command that repairs a warning", () => {
    const text = report([
      {
        name: "cli-version",
        status: "warn",
        message: "behind",
        details: { latest: "2.0.0", remedy_command: "npx @zitadel/cli@latest upgrade" },
      },
    ]);

    expect(text).toContain("→ npx @zitadel/cli@latest upgrade");
  });

  it("lets upgrade stand in for aligning the pins with an older CLI", () => {
    const text = report([
      {
        name: "cli-version",
        status: "warn",
        message: "behind",
        details: { latest: "2.0.0", remedy_command: "npx @zitadel/cli@latest upgrade" },
      },
      {
        name: "dependency-version",
        status: "warn",
        message: "pins differ",
        details: { remedy_command: "npm install --save-exact @zitadel/sdk-next@1.0.0" },
      },
    ]);

    expect(text).toContain("→ npx @zitadel/cli@latest upgrade");
    expect(text).not.toContain("npm install --save-exact");
  });

  it("offers setup in a directory with no project, and no project checks", () => {
    const text = report([pass("port")], { projectConfigured: false });

    expect(text).toContain("[-] Project");
    expect(text).toContain("no zitadel.json in this directory");
    expect(text).toContain("→ npx @zitadel/cli@1.0.0 setup");
    expect(text).not.toContain("Credentials");
  });

  it("carries --cwd in the setup it offers", () => {
    const text = report([pass("port")], { projectConfigured: false, typedCwd: "apps/web" });

    expect(text).toContain("→ npx @zitadel/cli@1.0.0 setup --cwd apps/web");
  });

  it("says a hosted project uses no local server", () => {
    const text = report([pass("config")], { hostedServer: "https://z.example" });

    expect(text).toContain("[-] Local server");
    expect(text).toContain("https://z.example");
  });

  it("leaves out a category no check ran for", () => {
    expect(report([pass("port")])).not.toContain("Environment");
  });

  it("ends with the next steps, not repeating a command shown under a row", () => {
    const upgrade = "npx @zitadel/cli@latest upgrade";
    const text = report(
      [
        {
          name: "cli-version",
          status: "warn",
          message: "behind",
          details: { latest: "2.0.0", remedy_command: upgrade },
        },
      ],
      { next: { actions: ["Do the thing."], commands: [upgrade, "zitadel doctor --fix"] } },
    );

    expect(text).toContain("Next:\n  Do the thing.");
    expect(text).toContain("$ zitadel doctor --fix");
    expect(text.split(upgrade)).toHaveLength(2);
  });

  it("puts a warning's fix under it, not again among the next steps", () => {
    const stop = "npx @zitadel/cli@1.0.0 stop --all";
    const action = "Check the other local Zitadel servers.";
    const text = report(
      [
        pass("runtime"),
        {
          name: "managed-runtime-processes",
          status: "warn",
          message: "1 other local Zitadel server is running on this machine.",
        },
      ],
      {
        next: { actions: [action, "Watch the log."], commands: [stop] },
        fixes: [{ check: "managed-runtime-processes", action, command: stop }],
      },
    );

    expect(text).toContain(
      `    ! 1 other local Zitadel server is running on this machine.\n    → ${stop}`,
    );
    expect(text).not.toContain(action);
    expect(text).toContain("Next:\n  Watch the log.");
    expect(text.split(stop)).toHaveLength(2);
  });

  it("says whether the local server is running", () => {
    expect(report([pass("runtime")])).toContain("running on port 8080 (binary)");
    expect(report([{ name: "runtime", status: "fail", message: "down" }])).toContain(
      "port 8080 (binary)",
    );
    expect(report([{ name: "runtime", status: "fail", message: "down" }])).not.toContain(
      "running on",
    );
  });

  it("ends with how to see every check, unless it shows them", () => {
    expect(report([pass("config"), pass("schema")])).toContain("Run with -v to see all 2 checks.");
    expect(report([pass("config")], { verbose: true })).not.toContain("Run with -v");
  });

  it("wraps a long message under itself to the terminal's width", () => {
    const text = report([{ name: "schema", status: "warn", message: "word ".repeat(20).trim() }], {
      columns: 40,
    });
    const lines = text.split("\n").filter((line) => line.includes("word"));

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("    ! word")).toBe(true);
    expect(lines[1]?.startsWith("      word")).toBe(true);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });

  it.each([undefined, 0])("does not wrap at a width of %s", (columns) => {
    const message = "word ".repeat(40).trim();

    expect(report([{ name: "schema", status: "warn", message }], { columns })).toContain(message);
  });
});
