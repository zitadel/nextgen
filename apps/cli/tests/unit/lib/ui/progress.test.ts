import { stripVTControlCharacters as stripAnsi } from "node:util";
import { describe, expect } from "vitest";

import { Chain } from "@/lib/ui/chain";
import { Progress } from "@/lib/ui/progress";
import { atScreenRecording } from "@tests/helpers/fixtures";
import type { Terminal } from "@tests/helpers/keyboard";

/** The chain progress draws into, as a person watching a wizard or a normal command sees it. */
const chain = (interactive: boolean, chained = true): Chain =>
  new Chain({ interactive, force: false }, chained ? "wizard" : "plain");

/**
 * Every line drawn but the chain's heading, in order, with its mark, and the gutter left
 * out. Clack puts two spaces after a mark; one reads the same here.
 */
const drawn = (screen: Terminal): string[] =>
  stripAnsi(screen.shown())
    .split("\n")
    .map((line) => line.trimEnd().replace(/^(\S) {2}/, "$1 "))
    .filter((line) => line !== "" && line !== "│" && !line.startsWith("┌"));

/** `it` with the terminal the run is at and what was said through `log`, which every test records. */
const it = atScreenRecording.extend<{
  at: (level: string) => string[];
  said: () => string[];
}>({
  at: ({ recorded }, use) => {
    return use((level) => {
      return recorded.said
        .filter((line) => {
          return line.level === level;
        })
        .map((line) => {
          return line.text;
        });
    });
  },
  said: ({ at }, use) => {
    return use(() => {
      return at("plain").map((text) => {
        return stripAnsi(text);
      });
    });
  },
});

describe("Progress", () => {
  describe("work as a callback", () => {
    it("returns what the work returned", async () => {
      await expect(new Progress(chain(true)).run("Fetching", async () => 42)).resolves.toBe(42);
    });

    it("closes the step as failed when nobody is watching and the work throws", async ({ at }) => {
      await expect(
        new Progress(chain(false)).run("Fetching", async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      expect(at("start")).toEqual(["Fetching"]);
      expect(at("fail")).toEqual(["Fetching failed"]);
    });

    it("spins while it runs and says so when it is done", async ({ screen }) => {
      await new Progress(chain(true)).run("Removing the origin", async () => undefined);

      expect(drawn(screen)).toEqual(["✔ Removing the origin"]);
    });

    it("lets the work name its own result", async ({ screen }) => {
      await new Progress(chain(true)).run(
        "Fetching users",
        async () => ["a", "b"],
        (users) => `Fetched ${users.length} users`,
      );

      expect(drawn(screen)).toEqual(["✔ Fetched 2 users"]);
    });

    it("lists what the work reported under its result, verbs aligned", async ({ screen }) => {
      await new Progress(chain(true)).run("Writing", async (report) => {
        report.done("Wrote", ".env.local");
        report.skipped("Left", "flows/default-login.json");
        report.warning("Check", "no claim_mapping");
      });

      expect(drawn(screen).slice(1)).toEqual([
        "│   Wrote  .env.local",
        "│ – Left   flows/default-login.json",
        "│ ! Check  no claim_mapping",
      ]);
    });

    // Reported rows are a column layout this builds itself, so a long subject
    // keeps its row whole rather than folding the verb out of its column.
    it("leaves a reported row whole, however long its subject", async ({ screen }) => {
      const subject =
        ".zitadel/schemas/default-human-user.json and .zitadel/flows/default-login.json";

      await new Progress(chain(true)).run("Writing", async (report) => {
        report.done("Wrote", subject);
      });

      expect(drawn(screen).slice(1)).toEqual([`│   Wrote  ${subject}`]);
    });

    it("says the step failed and lets the error through", async ({ screen }) => {
      const boom = new Error("boom");

      await expect(
        new Progress(chain(true)).run("Removing the origin", () => Promise.reject(boom)),
      ).rejects.toBe(boom);
      expect(drawn(screen)).toEqual(["✖ Removing the origin failed"]);
    });

    it("opens the chain before it draws into it", async ({ screen }) => {
      await new Progress(chain(true)).run("Fetching", async () => undefined);

      expect(stripAnsi(screen.shown()).startsWith("┌")).toBe(true);
    });

    it("narrates as plain lines when nobody is watching", async ({ at, screen }) => {
      await new Progress(chain(false)).run("Fetching users", async (report) => {
        report.done("Wrote", ".env.local");
      });

      expect(screen.shown()).toBe("");
      expect(at("start")).toEqual(["Fetching users"]);
      expect(at("info")).toEqual(["Wrote .env.local"]);
      expect(at("done")).toEqual(["Fetching users"]);
    });
  });

  describe("a step the caller ends itself", () => {
    it("ends with the result it is given", ({ screen }) => {
      new Progress(chain(true)).begin("Detecting framework").done("Detected Next.js");

      expect(drawn(screen)).toEqual(["✔ Detected Next.js"]);
    });

    it("falls back to its own label when the caller names no result", ({ screen }) => {
      new Progress(chain(true)).begin("Detecting framework").done();

      expect(drawn(screen)).toEqual(["✔ Detecting framework"]);
    });

    it("draws a detail too wide for the chain on one line, as the terminal wraps it", ({
      screen,
    }) => {
      const step = new Progress(chain(true)).begin("Patching project files");
      const wide = `Wrote the editable default human user schema (${"x".repeat(100)}.json)`;
      step.detail(wide);
      step.done("Patched 1 file");

      expect(drawn(screen).slice(1)).toEqual([`│ ${wide}`]);
    });

    it("lists the detail it collected under its result", ({ screen }) => {
      const step = new Progress(chain(true)).begin("Patching project files");
      step.detail("src/app/page.tsx");
      step.done("Patched 1 file");

      expect(drawn(screen)).toEqual(["✔ Patched 1 file", "│ src/app/page.tsx"]);
    });

    it("draws a detail given after the step has ended, under it, rather than losing it", ({
      screen,
    }) => {
      const step = new Progress(chain(true)).begin("Patching project files");
      step.done("Patched 1 file");
      step.detail("src/app/page.tsx");

      expect(drawn(screen)).toEqual(["✔ Patched 1 file", "│ src/app/page.tsx"]);
    });

    it("ends once, however many times it is ended", ({ screen }) => {
      const step = new Progress(chain(true)).begin("Detecting framework");
      step.done("Detected Next.js");
      step.fail("Detected nothing");

      expect(drawn(screen)).toEqual(["✔ Detected Next.js"]);
    });

    it("marks a step that failed", ({ screen }) => {
      new Progress(chain(true)).begin("Detecting framework").fail();

      expect(drawn(screen)).toEqual(["✖ Detecting framework failed"]);
    });

    it("narrates as plain lines when nobody is watching", ({ at, screen }) => {
      const step = new Progress(chain(false)).begin("Detecting framework");
      step.detail("package.json");
      step.done("Detected Next.js");

      expect(screen.shown()).toBe("");
      expect(at("info")).toEqual(["package.json"]);
      expect(at("done")).toEqual(["Detected Next.js"]);
    });

    // Ending once is the step's contract, not the chain's: a caller that ends
    // its step in both a try and a catch must not say so twice off a terminal.
    it("ends once when nobody is watching, however many times it is ended", ({ at }) => {
      const step = new Progress(chain(false)).begin("Detecting framework");
      step.done("Detected Next.js");
      step.fail("Detected nothing");

      expect(at("done")).toHaveLength(1);
      expect(at("fail")).toEqual([]);
    });
  });
});

// `Chain.spinner` was taught to keep out of the gutter a normal command does
// not have; `task` and `begin` were not, so either one drew a `│` above that
// command's answer and made it look like a wizard that happened to do work.
describe("progress for a command that draws no chain", () => {
  it("draws no gutter for work as a callback", async ({ screen }) => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(stripAnsi(screen.shown())).not.toContain("│");
  });

  it("says what the work ended on, as a plain line", async ({ said }) => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(said()).toEqual(["Fetching variables"]);
  });

  it("keeps its spinner out of the gutter too", async ({ screen }) => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(stripAnsi(screen.shown())).not.toContain("│");
  });

  it("indents what the work reported under its result", async ({ said }) => {
    await new Progress(chain(true, false)).run("Fetching variables", async (report) => {
      report.done("Read", "two variables");
    });

    expect(said()).toEqual(["Fetching variables", "    Read  two variables"]);
  });

  it("draws no gutter for a hand-ended step either", ({ screen }) => {
    new Progress(chain(true, false)).begin("Fetching variables").done();

    expect(stripAnsi(screen.shown())).not.toContain("│");
  });

  it("still narrates with nobody watching, whatever the shape", async ({ screen }) => {
    await new Progress(chain(false, false)).run("Fetching variables", async () => undefined);

    expect(screen.shown()).toBe("");
  });
});
