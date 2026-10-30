import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { log, spinner } from "@clack/prompts";
import { consola } from "consola";

import { type Drawing, Progress } from "../../../../src/lib/ui/progress";

/** A chain that remembers what progress asked of it, and draws nothing. */
const chain = (
  interactive: boolean,
  chained = true,
): Drawing & { opened: number; gaps: number } => ({
  interactive,
  chained,
  opened: 0,
  gaps: 0,
  open() {
    this.opened += 1;
  },
  closeGap() {
    this.gaps += 1;
  },
});

/** Every line drawn in the chain, in order, with its mark. */
const drawn = (): string[] =>
  vi
    .mocked(log.message)
    .mock.calls.map(([text, options]) =>
      `${stripAnsi(String(options?.symbol ?? ""))} ${stripAnsi(String(text))}`.trim(),
    );

beforeEach(() => {
  vi.spyOn(consola, "start").mockImplementation(() => undefined);
  vi.spyOn(consola, "info").mockImplementation(() => undefined);
  vi.spyOn(consola, "success").mockImplementation(() => undefined);
  vi.spyOn(consola, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Progress", () => {
  describe("work as a callback", () => {
    it("returns what the work returned", async () => {
      await expect(new Progress(chain(true)).run("Fetching", async () => 42)).resolves.toBe(42);
    });

    it("spins while it runs and says so when it is done", async () => {
      await new Progress(chain(true)).run("Removing the origin", async () => undefined);

      expect(spinner).toHaveBeenCalled();
      expect(drawn()).toEqual(["✔ Removing the origin"]);
    });

    it("lets the work name its own result", async () => {
      await new Progress(chain(true)).run(
        "Fetching users",
        async () => ["a", "b"],
        (users) => `Fetched ${users.length} users`,
      );

      expect(drawn()).toEqual(["✔ Fetched 2 users"]);
    });

    it("lists what the work reported under its result, verbs aligned", async () => {
      await new Progress(chain(true)).run("Writing", async (report) => {
        report.done("Wrote", ".env.local");
        report.skipped("Left", "flows/default-login.json");
        report.warning("Check", "no claim_mapping");
      });

      expect(drawn().slice(1)).toEqual([
        "│   Wrote  .env.local",
        "│ – Left   flows/default-login.json",
        "│ ! Check  no claim_mapping",
      ]);
    });

    // Reported rows are a column layout this builds itself, so a long subject
    // keeps its row whole rather than folding the verb out of its column.
    it("leaves a reported row whole, however long its subject", async () => {
      const subject =
        ".zitadel/schemas/default-human-user.json and .zitadel/flows/default-login.json";

      await new Progress(chain(true)).run("Writing", async (report) => {
        report.done("Wrote", subject);
      });

      expect(drawn().slice(1)).toEqual([`│   Wrote  ${subject}`]);
    });

    it("says the step failed and lets the error through", async () => {
      const boom = new Error("boom");

      await expect(
        new Progress(chain(true)).run("Removing the origin", () => Promise.reject(boom)),
      ).rejects.toBe(boom);
      expect(drawn()).toEqual(["✖ Removing the origin failed"]);
    });

    it("opens the chain before it draws into it", async () => {
      const drawing = chain(true);

      await new Progress(drawing).run("Fetching", async () => undefined);

      expect(drawing.opened).toBe(1);
    });

    it("narrates as plain lines when nobody is watching", async () => {
      await new Progress(chain(false)).run("Fetching users", async (report) => {
        report.done("Wrote", ".env.local");
      });

      expect(spinner).not.toHaveBeenCalled();
      expect(consola.start).toHaveBeenCalledWith("Fetching users");
      expect(consola.info).toHaveBeenCalledWith("Wrote .env.local");
      expect(consola.success).toHaveBeenCalledWith("Fetching users");
    });
  });

  describe("a step the caller ends itself", () => {
    it("ends with the result it is given", () => {
      new Progress(chain(true)).begin("Detecting framework").done("Detected Next.js");

      expect(drawn()).toEqual(["✔ Detected Next.js"]);
    });

    it("falls back to its own label when the caller names no result", () => {
      new Progress(chain(true)).begin("Detecting framework").done();

      expect(drawn()).toEqual(["✔ Detecting framework"]);
    });

    it("lists the detail it collected under its result", () => {
      const step = new Progress(chain(true)).begin("Patching project files");
      step.detail("src/app/page.tsx");
      step.done("Patched 1 file");

      expect(drawn()).toEqual(["✔ Patched 1 file", "│ src/app/page.tsx"]);
    });

    // A step names what it did, which for `setup` is a sentence and a path:
    // unwrapped, the longest of those runs past the chain it is drawn in.
    it("folds a detail line too wide for the chain", () => {
      const step = new Progress(chain(true)).begin("Patching project files");
      step.detail(
        "Wrote the editable default human user schema (.zitadel/schemas/default-human-user.json)",
      );
      step.done("Patched 1 file");

      expect(drawn().slice(1)).toEqual([
        "│ Wrote the editable default human user schema\n(.zitadel/schemas/default-human-user.json)",
      ]);
    });

    it("folds a result line too wide for the chain", () => {
      new Progress(chain(true))
        .begin("Moving the app")
        .done(
          "Moved the app from http://localhost:3000 to http://localhost:4000, and told the project about it",
        );

      expect(drawn()).toEqual([
        "✔ Moved the app from http://localhost:3000 to http://localhost:4000, and told\nthe project about it",
      ]);
    });

    it("ends once, however many times it is ended", () => {
      const step = new Progress(chain(true)).begin("Detecting framework");
      step.done("Detected Next.js");
      step.fail("Detected nothing");

      expect(drawn()).toEqual(["✔ Detected Next.js"]);
    });

    it("marks a step that failed", () => {
      new Progress(chain(true)).begin("Detecting framework").fail();

      expect(drawn()).toEqual(["✖ Detecting framework failed"]);
    });

    it("narrates as plain lines when nobody is watching", () => {
      const step = new Progress(chain(false)).begin("Detecting framework");
      step.detail("package.json");
      step.done("Detected Next.js");

      expect(spinner).not.toHaveBeenCalled();
      expect(consola.info).toHaveBeenCalledWith("package.json");
      expect(consola.success).toHaveBeenCalledWith("Detected Next.js");
    });

    // Ending once is the step's contract, not the chain's: a caller that ends
    // its step in both a try and a catch must not say so twice off a terminal.
    it("ends once when nobody is watching, however many times it is ended", () => {
      const step = new Progress(chain(false)).begin("Detecting framework");
      step.done("Detected Next.js");
      step.fail("Detected nothing");

      expect(consola.success).toHaveBeenCalledTimes(1);
      expect(consola.error).not.toHaveBeenCalled();
    });
  });
});

// `Chain.spinner` was taught to keep out of the gutter a normal command does
// not have; `task` and `begin` were not, so either one drew a `│` above that
// command's answer and made it look like a wizard that happened to do work.
describe("progress for a command that draws no chain", () => {
  const said = (): string[] =>
    vi.mocked(consola.log).mock.calls.map(([text]) => stripAnsi(String(text)));

  beforeEach(() => {
    vi.spyOn(consola, "log").mockImplementation(() => undefined);
  });

  it("draws no gutter for work as a callback", async () => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(log.message).not.toHaveBeenCalled();
  });

  it("says what the work ended on, as a plain line", async () => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(said()).toEqual(["Fetching variables"]);
  });

  it("keeps its spinner out of the gutter too", async () => {
    await new Progress(chain(true, false)).run("Fetching variables", async () => undefined);

    expect(spinner).toHaveBeenCalledWith({ withGuide: false });
  });

  it("indents what the work reported under its result", async () => {
    await new Progress(chain(true, false)).run("Fetching variables", async (report) => {
      report.done("Read", "two variables");
    });

    expect(said()).toEqual(["Fetching variables", "    Read  two variables"]);
  });

  it("draws no gutter for a hand-ended step either", () => {
    new Progress(chain(true, false)).begin("Fetching variables").done();

    expect(log.message).not.toHaveBeenCalled();
  });

  it("still narrates with nobody watching, whatever the shape", async () => {
    await new Progress(chain(false, false)).run("Fetching variables", async () => undefined);

    expect(spinner).not.toHaveBeenCalled();
  });
});
