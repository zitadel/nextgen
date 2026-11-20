import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GenericContainer, Wait } from "testcontainers";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");

/** The OpenAPI sources, where the ruleset, the ignore file and the baseline live. */
export const openapiDir = resolve(repoRoot, "apps/api/api/openapi");

/**
 * The vacuum-plugin-extra image the lint runs. Pinned by digest, never `latest`:
 * a new release adds rules, and a lint whose findings change without a change to
 * the API is a lint nobody trusts.
 */
export const LINTER_IMAGE =
  "mridang/vacuum-extra:1.17.0@sha256:caedd3d9efc8a5d07b404dff1d0c8ecab1c7b4f30821a87b45d285138390f133";

/** One thing the linter found, as `vacuum-extra -format json` reports it. */
export type Finding = {
  rule: string;
  severity: string;
  path: string;
  line: number;
  column: number;
  message: string;
};

/**
 * Runs vacuum with the extra rules over the API's OpenAPI document, in a
 * container of {@link LINTER_IMAGE}, with the repo's ruleset and ignore file, and
 * returns every finding. The sources are mounted read-only and the container
 * runs once and exits. It never fails on a finding (`-fail-on none`): the tests
 * judge them. What the linter writes to stderr lands in the same log as the
 * findings, so it fails the parse and the log is the error.
 *
 * @returns the findings
 * @throws when the container cannot start, or what it printed is not the findings
 */
export async function lintSpec(): Promise<Finding[]> {
  const container = await new GenericContainer(LINTER_IMAGE)
    .withBindMounts([{ source: openapiDir, target: "/work", mode: "ro" }])
    .withWorkingDir("/work")
    .withCommand([
      "-r",
      "vacuum-ruleset.yaml",
      "-ignore-file",
      "vacuum-ignore.yaml",
      "-format",
      "json",
      "-fail-on",
      "none",
      "openapi-spec.yaml",
    ])
    .withWaitStrategy(Wait.forOneShotStartup())
    .start();
  let log = "";
  try {
    for await (const chunk of await container.logs()) {
      log += chunk.toString();
    }
  } finally {
    await container.stop();
  }
  try {
    return JSON.parse(log) as Finding[];
  } catch {
    throw new Error(`vacuum-extra did not print the findings as JSON:\n${log}`);
  }
}

/**
 * The findings the spec has today and has not fixed yet, one line per finding
 * (`<rule> <path>`), sorted. A new finding fails the lint and a fixed one fails
 * it until its line is removed (`UPDATE_LINT_BASELINE=1` removes them), so the
 * file only shrinks.
 */
export class Baseline {
  private static readonly file = resolve(openapiDir, "vacuum-baseline.json");

  private readonly lines: string[];

  private constructor(lines: string[]) {
    this.lines = lines;
  }

  /**
   * Reads the baseline from `vacuum-baseline.json` beside the spec.
   *
   * @returns the baseline
   */
  static async load(): Promise<Baseline> {
    return new Baseline(JSON.parse(await readFile(Baseline.file, "utf8")) as string[]);
  }

  /**
   * A baseline of the given lines, for tests.
   *
   * @param lines `<rule> <path>` lines
   * @returns the baseline
   */
  static of(lines: string[]): Baseline {
    return new Baseline(lines);
  }

  /**
   * The baseline without the lines nothing reports any more. A finding the
   * baseline does not list is never added: the baseline only shrinks.
   *
   * @param findings what the linter found
   * @returns the sorted lines that are left
   */
  shrunk(findings: Finding[]): string[] {
    return Baseline.difference(this.lines, this.fixedFindings(findings)).sort();
  }

  /**
   * Writes {@link shrunk} to `vacuum-baseline.json`.
   *
   * @param findings what the linter found
   */
  async shrink(findings: Finding[]): Promise<void> {
    await writeFile(Baseline.file, `${JSON.stringify(this.shrunk(findings), null, 2)}\n`);
  }

  /**
   * The line a finding is known by.
   *
   * @param finding a finding
   * @returns `<rule> <path>`
   */
  static line(finding: Finding): string {
    return `${finding.rule} ${finding.path}`;
  }

  /**
   * The findings the baseline does not list.
   *
   * @param findings what the linter found
   * @returns one `<rule> <path>` line per new finding
   */
  newFindings(findings: Finding[]): string[] {
    return Baseline.difference(
      findings.map((finding) => {
        return Baseline.line(finding);
      }),
      this.lines,
    );
  }

  /**
   * The baseline lines nothing reports any more.
   *
   * @param findings what the linter found
   * @returns the lines to remove from the baseline
   */
  fixedFindings(findings: Finding[]): string[] {
    return Baseline.difference(
      this.lines,
      findings.map((finding) => {
        return Baseline.line(finding);
      }),
    );
  }

  /**
   * The lines of `from` that `without` does not cover, counting repeats.
   *
   * @param from the lines to start from
   * @param without the lines to take away, once each
   * @returns what is left of `from`
   */
  private static difference(from: string[], without: string[]): string[] {
    const spent = new Map<string, number>();
    for (const line of without) {
      spent.set(line, (spent.get(line) ?? 0) + 1);
    }
    return from.filter((line) => {
      const left = spent.get(line) ?? 0;
      if (left > 0) {
        spent.set(line, left - 1);
        return false;
      }
      return true;
    });
  }
}
