import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type CheckOutcome, SANITY_CHECKS } from "@/commands/doctor/checks";
import {
  CHECK_CATEGORIES,
  categoryOf,
  type DoctorReportInput,
  renderDoctorReport,
  withCategories,
} from "@/commands/doctor/report";
import { aSuggest } from "@tests/helpers/suggestions";

/**
 * The cause several credential checks share when the secret is gone.
 */
const SECRET_MISSING = ".zitadel/secret was not found";

/**
 * The command that upgrades the CLI.
 */
const UPGRADE = "npx @zitadel/cli@latest upgrade";

/**
 * A CLI version check that found a newer release.
 */
const BEHIND: CheckOutcome = {
  name: "cli-version",
  status: "warn",
  message: "behind",
  details: { latest: "2.0.0", remedy_command: UPGRADE },
};

/**
 * Every check the command files under a category.
 */
const FILED = CHECK_CATEGORIES.flatMap((category) => {
  return category.checks;
});

/**
 * The doctor's report of `checks`, for a configured project whose local
 * server runs as a binary on port 8080.
 *
 * @param checks - What the checks found.
 * @param input - What the report differs in from the default.
 * @returns The rendered report.
 */
function report(checks: CheckOutcome[], input: Partial<DoctorReportInput> = {}): string {
  return renderDoctorReport({
    checks,
    cliVersion: "1.0.0",
    suggest: aSuggest({}, "1.0.0"),
    projectConfigured: true,
    runtime: "binary",
    port: 8080,
    next: {},
    verbose: false,
    ...input,
  });
}

/**
 * A check that passed.
 *
 * @param name - The check's name.
 * @param message - What it said.
 * @returns The outcome.
 */
function pass(name: string, message = `${name} ok`): CheckOutcome {
  return { name, status: "pass", message };
}

/**
 * How many times `text` says `phrase`.
 *
 * @param text - The report.
 * @param phrase - What to count.
 * @returns The count.
 */
function timesSaid(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

/**
 * The names of the checks `src/commands/doctor/index.ts` builds itself.
 *
 * @returns The names.
 */
async function checksTheCommandBuilds(): Promise<string[]> {
  const source = await readFile(
    join(import.meta.dirname, "../../../../src/commands/doctor/index.ts"),
    "utf8",
  );
  return [...source.matchAll(/(?:await check\(\s*|check\(\s*|name: )"([a-z-]+)"/g)].flatMap(
    (match) => {
      return match[1] === undefined ? [] : [match[1]];
    },
  );
}

describe("CHECK_CATEGORIES", () => {
  it.each(
    SANITY_CHECKS.map((check) => {
      return check.name;
    }),
  )("files the registered check %s", (name) => {
    expect(FILED).toContain(name);
  });

  it("files every check the command builds itself", async () => {
    const built = await checksTheCommandBuilds();

    expect(FILED).toEqual(expect.arrayContaining(built));
  });

  it("finds checks the command builds itself", async () => {
    const built = await checksTheCommandBuilds();

    expect(built).not.toEqual([]);
  });

  it("files a check under one category only", () => {
    expect(new Set(FILED).size).toBe(FILED.length);
  });
});

describe("withCategories", () => {
  it("puts the category on the checks the envelope carries", () => {
    const checks = withCategories([pass("port")]);

    expect(checks).toEqual([
      { name: "port", status: "pass", message: "port ok", category: "local_server" },
    ]);
  });
});

describe("categoryOf", () => {
  it("names the category a check is filed under", () => {
    expect(categoryOf("secret")).toBe("credentials");
  });
});

describe("renderDoctorReport", () => {
  describe("when a category's checks all passed", () => {
    const text = report([pass("config"), pass("schema")]);

    it.each(["[✓] Project", "2 checks passed"])("says %s", (said) => {
      expect(text).toContain(said);
    });

    it("leaves the verdict to the title above it", () => {
      expect(text).not.toContain("Zitadel doctor passed");
    });

    it("collapses the category", () => {
      expect(text).not.toContain("config ok");
    });

    it("ends with how to see every check", () => {
      expect(text).toContain("Run with -v to see all 2 checks.");
    });
  });

  describe("when a category needs attention", () => {
    const text = report([
      pass("config"),
      { name: "schema", status: "warn", message: "No schema files" },
    ]);

    it.each(["[!] Project", "    ! No schema files"])("says %s", (said) => {
      expect(text).toContain(said);
    });

    it("leaves the verdict to the title above it", () => {
      expect(text).not.toContain("Zitadel doctor passed");
    });

    it("leaves out the checks that passed", () => {
      expect(text).not.toContain("config ok");
    });
  });

  describe("when checks of a category disagree", () => {
    const text = report([
      { name: "framework", status: "warn", message: "a warning" },
      { name: "dependency", status: "fail", message: "a failure" },
      { name: "secret", status: "fail", message: "another" },
    ]);

    it("marks the category by the worst of its checks", () => {
      expect(text).toContain("[✗] App integration");
    });

    it("counts the categories with issues", () => {
      expect(text).toContain("✗ Zitadel doctor found issues in 2 categories.");
    });
  });

  it("says a cause several checks share once", () => {
    const text = report([
      { name: "secret", status: "fail", message: SECRET_MISSING },
      { name: "secret-permissions", status: "fail", message: SECRET_MISSING },
      { name: "project-match", status: "fail", message: SECRET_MISSING },
    ]);

    expect(timesSaid(text, SECRET_MISSING)).toBe(1);
  });

  it("orders the categories whatever order the checks ran in", () => {
    const text = report([pass("config"), pass("port"), pass("cli-version")]);

    const positions = ["Versions", "Local server", "Project"].map((category) => {
      return text.indexOf(category);
    });

    expect(positions).toEqual(
      [...positions].sort((a, b) => {
        return a - b;
      }),
    );
  });

  it("leaves out a category no check ran for", () => {
    const text = report([pass("port")]);

    expect(text).not.toContain("Environment");
  });

  describe("with --verbose", () => {
    it("expands every check, by name", () => {
      const text = report([pass("config")], { verbose: true });

      expect(text).toContain("✓ config: config ok");
    });

    it("does not say how to see every check", () => {
      const text = report([pass("config")], { verbose: true });

      expect(text).not.toContain("Run with -v");
    });

    it.each(["secret", "project-match"])("names %s, which shares a cause", (name) => {
      const text = report(
        [
          { name: "secret", status: "fail", message: SECRET_MISSING },
          { name: "project-match", status: "fail", message: SECRET_MISSING },
        ],
        { verbose: true },
      );

      expect(text).toContain(`${name}: ${SECRET_MISSING}`);
    });
  });

  describe("with the CLI's version", () => {
    it("shows it", () => {
      const text = report([pass("cli-version")]);

      expect(text).toContain("CLI 1.0.0");
    });

    it("shows the newer one when there is one", () => {
      const text = report([BEHIND]);

      expect(text).toContain("CLI 1.0.0, 2.0.0 available");
    });

    it("pulls out the command that repairs a warning", () => {
      const text = report([BEHIND]);

      expect(text).toContain(`→ ${UPGRADE}`);
    });

    it("lets upgrade stand in for aligning the pins with an older CLI", () => {
      const text = report([
        BEHIND,
        {
          name: "dependency-version",
          status: "warn",
          message: "pins differ",
          details: { remedy_command: "npm install --save-exact @zitadel/sdk-next@1.0.0" },
        },
      ]);

      expect(text).not.toContain("npm install --save-exact");
    });
  });

  describe("in a directory with no project", () => {
    const text = report([pass("port")], { projectConfigured: false });

    it.each(["[-] Project", "no zitadel.json in this directory", "→ npx @zitadel/cli@1.0.0 setup"])(
      "says %s",
      (said) => {
        expect(text).toContain(said);
      },
    );

    it("runs no project checks", () => {
      expect(text).not.toContain("Credentials");
    });

    it("carries --cwd in the setup it offers", () => {
      const typed = report([pass("port")], {
        projectConfigured: false,
        suggest: aSuggest({ cwd: "apps/web" }, "1.0.0"),
      });

      expect(typed).toContain("→ npx @zitadel/cli@1.0.0 setup --cwd apps/web");
    });
  });

  describe("with a hosted project", () => {
    const text = report([pass("config")], { hostedServer: "https://z.example" });

    it.each(["[-] Local server", "https://z.example"])("says %s", (said) => {
      expect(text).toContain(said);
    });
  });

  describe("with the local server", () => {
    it("says it is running", () => {
      const text = report([pass("runtime")]);

      expect(text).toContain("running on port 8080 (binary)");
    });

    it("names its port when it is down", () => {
      const text = report([{ name: "runtime", status: "fail", message: "down" }]);

      expect(text).toContain("port 8080 (binary)");
    });

    it("does not call it running when it is down", () => {
      const text = report([{ name: "runtime", status: "fail", message: "down" }]);

      expect(text).not.toContain("running on");
    });
  });

  describe("with next steps", () => {
    const next = { actions: ["Do the thing."], commands: [UPGRADE, "zitadel doctor --fix"] };
    const text = report([BEHIND], { next });

    it.each(["Next:\n  Do the thing.", "$ zitadel doctor --fix"])("says %s", (said) => {
      expect(text).toContain(said);
    });

    it("does not repeat a command shown under a row", () => {
      expect(timesSaid(text, UPGRADE)).toBe(1);
    });
  });

  describe("with a warning whose fix is known", () => {
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

    it("puts the fix's command under the warning", () => {
      expect(text).toContain(
        `    ! 1 other local Zitadel server is running on this machine.\n    → ${stop}`,
      );
    });

    it("does not repeat the fix's action", () => {
      expect(text).not.toContain(action);
    });

    it("keeps the other next steps", () => {
      expect(text).toContain("Next:\n  Watch the log.");
    });

    it("shows the fix's command once", () => {
      expect(timesSaid(text, stop)).toBe(1);
    });
  });

  describe("with a long message", () => {
    const message = "word ".repeat(20).trim();
    const lines = report([{ name: "schema", status: "warn", message }], { columns: 40 })
      .split("\n")
      .filter((line) => {
        return line.includes("word");
      });

    it("wraps it", () => {
      expect(lines.length).toBeGreaterThan(1);
    });

    it("starts it under the warning's mark", () => {
      expect(lines[0]).toMatch(/^ {4}! word/);
    });

    it("indents the lines it wraps under the message", () => {
      expect(lines[1]).toMatch(/^ {6}word/);
    });

    it("keeps every line within the terminal's width", () => {
      expect(
        lines.filter((line) => {
          return line.length > 40;
        }),
      ).toEqual([]);
    });

    it.each([undefined, 0])("does not wrap at a width of %s", (columns) => {
      const unwrapped = "word ".repeat(40).trim();

      const text = report([{ name: "schema", status: "warn", message: unwrapped }], { columns });

      expect(text).toContain(unwrapped);
    });
  });

  describe("with text it read from elsewhere", () => {
    it.each(["pass", "warn", "fail"] as const)(
      "spells out what a %s check's message names",
      (status) => {
        const text = report(
          [{ name: "schema", status, message: "at app.acme.com\u001b[2Jwiped" }],
          {
            verbose: true,
          },
        );

        expect(text).toContain("at app.acme.com\\x1b[2Jwiped");
      },
    );

    it("spells out the server a skipped category names", () => {
      const text = report([], { hostedServer: "https://acme.example\u001b[2Jwiped" });

      expect(text).toContain("https://acme.example\\x1b[2Jwiped");
    });
  });
});
