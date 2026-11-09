import { execaSync } from "execa";

import { type MockInstance, beforeEach, describe, expect, it, vi } from "vitest";

import type { AbstractCLIScaffolder } from "@/lib/orca/scaffolders/cli";
import { NODE_ENGINES_TIMEOUT_MS, describeAcceptedNode } from "@/lib/orca/scaffolders/node-engines";
import { takeReportedWarnings } from "@/lib/warnings";

/**
 * A Node that every framework CLI's range accepts, for the tests of a
 * scaffolder that are not about the Node check.
 */
export const SUPPORTED_NODE = "24.15.0";

/** What one scaffolder's Node check is tested against. */
export interface NodeEnginesCase {
  /** Builds the scaffolder for a Node version and platform. */
  readonly make: (node: string, platform?: NodeJS.Platform) => AbstractCLIScaffolder;
  readonly framework: string;
  /** How the framework CLI is named in messages, as the scaffolder declares it. */
  readonly label: string;
  /** The package spec the scaffolder runs and asks npm about. */
  readonly spec: string;
  readonly fallback: string;
  readonly enforcement: "refuse" | "warn";
  /** Node versions the fallback range accepts. */
  readonly supported: ReadonlyArray<string>;
  /** Node versions the framework CLI runs on only with a warning. */
  readonly warned: ReadonlyArray<string>;
  /** Node versions the framework CLI refuses (only when it enforces the range). */
  readonly refused: ReadonlyArray<string>;
}

/**
 * What the stubbed `execaSync` answers: the fields of execa's own result, any
 * of which a stub may leave out, as the code under test reads only a few.
 */
type SpawnAnswer = Partial<ReturnType<typeof execaSync>>;

/** The one form of `execaSync` the scaffolders call: a file, its arguments, options. */
type Spawn = (
  file: string,
  args: ReadonlyArray<string>,
  options: Record<string, unknown>,
) => SpawnAnswer;

/**
 * The `execaSync` every suite using these helpers mocks with `vi.fn()`.
 *
 * The cast stays: `execaSync` is an intersection of generic overloads (a
 * template tag, an options binder, two call forms), which no stub can
 * implement, so the mock is narrowed to the one call form the scaffolders use
 * and to the partial answers {@link SpawnAnswer} allows.
 */
const mockSpawn = vi.mocked(execaSync) as unknown as MockInstance<Spawn>;

/**
 * A spawn that ran to an exit.
 *
 * @param status - The exit status, which also decides whether it failed.
 * @param stdout - What it printed.
 * @returns The answer the stub gives.
 */
function spawnResult(status: number, stdout = ""): SpawnAnswer {
  return {
    exitCode: status,
    failed: status !== 0,
    stderr: "",
    stdout,
  };
}

/**
 * A spawn npm's lookup never finished: killed at the timeout, with no exit
 * status.
 *
 * @returns The answer the stub gives.
 */
function timedOut(): SpawnAnswer {
  return {
    ...spawnResult(0),
    exitCode: undefined,
    failed: true,
    timedOut: true,
    signal: "SIGTERM",
  };
}

/**
 * Whether a spawn was npm's engine lookup rather than the scaffolding.
 *
 * @param call - The spawn's arguments, as the mock recorded them.
 * @returns Whether it was `npm view`.
 */
function isLookup(call: Parameters<Spawn>): boolean {
  const [file, args] = call;
  return file === "npm" && args[0] === "view";
}

/** The spawns that were not the engine lookup: the scaffolding command itself. */
export function scaffoldingCalls(): ReadonlyArray<unknown[]> {
  return mockSpawn.mock.calls.filter((call) => !isLookup(call));
}

/**
 * npm answers the engine lookup with `answer`, and every other command
 * succeeds.
 *
 * @param answer - What the lookup answers.
 */
function lookupAnswers(answer: SpawnAnswer): void {
  mockSpawn.mockImplementation((command, args) => {
    return command === "npm" && args[0] === "view" ? answer : spawnResult(0);
  });
}

/**
 * npm says the framework CLI's published engine range is `range`.
 *
 * @param range - The `engines.node` range npm prints.
 */
function npmPublishes(range: string): void {
  lookupAnswers(spawnResult(0, `${range}\n`));
}

/**
 * The Node check every scaffolder that runs a framework CLI carries, as one
 * matrix: each scaffolder's test file calls it with its own CLI's package,
 * fallback range and sample Node versions, so the test names and wording are
 * the same everywhere. The calling file mocks `execa`.
 */
export function describeNodeEngines(c: NodeEnginesCase): void {
  describe("Node check", () => {
    beforeEach(() => {
      takeReportedWarnings();
    });

    it(`asks npm for the engine range of the ${c.spec} it runs`, async () => {
      npmPublishes(c.fallback);

      await c.make(SUPPORTED_NODE).scaffold("/tmp/proj", c.framework);

      expect(mockSpawn.mock.calls[0]?.slice(0, 2)).toEqual([
        "npm",
        ["view", c.spec, "engines.node"],
      ]);
    });

    it("bounds the npm lookup with a timeout", async () => {
      npmPublishes(c.fallback);

      await c.make(SUPPORTED_NODE).scaffold("/tmp/proj", c.framework);

      expect(mockSpawn.mock.calls[0]?.[2]).toMatchObject({ timeout: NODE_ENGINES_TIMEOUT_MS });
    });

    it.each([
      ["win32", true],
      ["darwin", false],
      ["linux", false],
    ] as const)(
      "runs the npm lookup through a shell only on Windows (%s)",
      async (platform, shell) => {
        npmPublishes(c.fallback);

        await c.make(SUPPORTED_NODE, platform).scaffold("/tmp/proj", c.framework);

        expect(mockSpawn.mock.calls[0]?.[0]).toBe("npm");
        expect(mockSpawn.mock.calls[0]?.[2]).toMatchObject({ shell });
      },
    );

    it.each(c.supported)(
      "runs the scaffolding command on Node %s, which it supports",
      async (node) => {
        npmPublishes(c.fallback);

        await c.make(node).scaffold("/tmp/proj", c.framework);

        expect(scaffoldingCalls()).toHaveLength(1);
      },
    );

    it.each(c.supported)("warns about nothing on Node %s, which it supports", async (node) => {
      npmPublishes(c.fallback);

      await c.make(node).scaffold("/tmp/proj", c.framework);

      expect(takeReportedWarnings()).toEqual([]);
    });

    it.each(c.warned)(
      "runs the scaffolding command on Node %s, which it only warns about",
      async (node) => {
        npmPublishes(c.fallback);

        await c.make(node).scaffold("/tmp/proj", c.framework);

        expect(scaffoldingCalls()).toHaveLength(1);
      },
    );

    it.each(c.warned)("warns on Node %s, which it only warns about", async (node) => {
      npmPublishes(c.fallback);

      await c.make(node).scaffold("/tmp/proj", c.framework);

      const odd =
        c.enforcement === "refuse" ? ", as odd-numbered Node versions never reach LTS" : "";
      expect(takeReportedWarnings()).toEqual([
        `${c.label} supports Node ${c.fallback}; it runs on Node v${node} with a warning${odd}`,
      ]);
    });

    if (c.enforcement === "refuse") {
      it.each(c.refused)("refuses Node %s before running the scaffolding command", async (node) => {
        npmPublishes(c.fallback);

        await expect(c.make(node).scaffold("/tmp/proj", c.framework)).rejects.toMatchObject({
          code: "E_VALIDATION",
        });
        expect(scaffoldingCalls()).toEqual([]);
      });

      it.each(c.refused)(
        "names the Node versions needed and the one running (v%s)",
        async (node) => {
          npmPublishes(c.fallback);

          await expect(c.make(node).scaffold("/tmp/proj", c.framework)).rejects.toThrow(
            `${c.label} needs Node ${c.fallback}; this is Node v${node}`,
          );
        },
      );

      it.each(c.refused)(
        "recommends the accepted majors, not the raw range, when it refuses Node %s",
        async (node) => {
          npmPublishes(c.fallback);

          await expect(c.make(node).scaffold("/tmp/proj", c.framework)).rejects.toMatchObject({
            hint: expect.stringContaining(`Switch to Node ${describeAcceptedNode(c.fallback)} and`),
          });
          await expect(c.make(node).scaffold("/tmp/proj", c.framework)).rejects.toMatchObject({
            hint: expect.not.stringContaining(c.fallback),
          });
        },
      );
    } else {
      it("refuses no Node, however far outside the range", async () => {
        npmPublishes(c.fallback);

        await c.make("99.0.0").scaffold("/tmp/proj", c.framework);

        expect(scaffoldingCalls()).toHaveLength(1);
      });
    }

    it("applies the range npm publishes over the built-in one", async () => {
      npmPublishes(">=98.0.0");

      const run = c.make(SUPPORTED_NODE).scaffold("/tmp/proj", c.framework);

      if (c.enforcement === "refuse") {
        await expect(run).rejects.toThrow(`needs Node >=98.0.0`);
      } else {
        await run;
        expect(takeReportedWarnings()).toEqual([
          `${c.label} supports Node >=98.0.0; it runs on Node v${SUPPORTED_NODE} with a warning`,
        ]);
      }
    });

    it.each([
      ["npm fails", spawnResult(1)],
      ["npm answers with no range", spawnResult(0, "\n")],
      ["npm answers with something that is not a range", spawnResult(0, "not a range\n")],
      ["npm times out", timedOut()],
    ])("falls back to the built-in range when %s", async (_case, answer) => {
      lookupAnswers(answer);
      const node = c.enforcement === "refuse" ? c.refused[0] : c.warned[0];

      const run = c.make(node ?? "0.0.0").scaffold("/tmp/proj", c.framework);

      if (c.enforcement === "refuse") {
        await expect(run).rejects.toThrow(`needs Node ${c.fallback}`);
      } else {
        await run;
        expect(takeReportedWarnings()).toEqual([
          `${c.label} supports Node ${c.fallback}; it runs on Node v${node} with a warning`,
        ]);
      }
    });
  });
}
