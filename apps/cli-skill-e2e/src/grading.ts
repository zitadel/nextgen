import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Assertion, Stage } from "./journey.ts";
import { type ParsedStage, parseStage, tokens } from "./transcript.ts";

/** One check the harness made itself: what it asked, and whether reality matched. */
export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export type Status = "pass" | "fail" | "blocked" | "skipped";

export interface Grade {
  readonly status: Status;
  readonly why: string;
  readonly asserts?: ReadonlyArray<CheckResult>;
}

export interface GradedStage extends Grade {
  readonly stage: number;
  readonly title: string;
  readonly parsed: ParsedStage;
  readonly tokens: number;
  readonly turns: number | "?";
  readonly ms: number;
}

/** A run on disk: out/<config>/<scenario>/<repeat>/. */
export interface Cell {
  readonly config: string;
  readonly model: string;
  readonly rep: string;
  readonly dir: string;
}

const folders = (path: string): ReadonlyArray<string> => {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
};

/**
 * The runs on disk that produced a first-stage trajectory, so the report and
 * the grader can enumerate a scenario×repeat matrix without knowing which
 * scenarios were chosen.
 */
export function listCells(outDir: string, configs: ReadonlyArray<string>): ReadonlyArray<Cell> {
  return configs
    .flatMap((config) =>
      folders(join(outDir, config)).flatMap((model) =>
        folders(join(outDir, config, model)).map((rep) => ({
          config,
          model,
          rep,
          dir: join(outDir, config, model, rep),
        })),
      ),
    )
    .filter((cell) => existsSync(join(cell.dir, "stage1.jsonl")));
}

const readIfPresent = (path: string): string =>
  existsSync(path) ? readFileSync(path, "utf8") : "";

type Json = unknown;

const follow = (base: Json, keys: ReadonlyArray<string>): Json =>
  keys.reduce<Json>(
    (current, key) =>
      current !== null && typeof current === "object"
        ? (current as Readonly<Record<string, Json>>)[key]
        : undefined,
    base,
  );

/**
 * Resolve a dotted path against a CLI `--json` response. The CLI wraps payloads
 * in an envelope (`{ data: … }`), so the object itself is tried first and then
 * its `.data`: the caller writes `projects` or `schema.properties.firstName`,
 * not the envelope.
 */
export function resolvePath(response: Json, path: string): Json {
  const keys = path.split(".");
  const direct = follow(response, keys);
  if (direct !== undefined) {
    return direct;
  }
  return response !== null && typeof response === "object" && "data" in response
    ? follow((response as { readonly data: Json }).data, keys)
    : undefined;
}

const SATISFIES: Readonly<Record<Assertion["op"], (actual: Json, expected: unknown) => boolean>> = {
  exists: (actual) => actual !== undefined && actual !== null,
  eq: (actual, expected) => actual === expected,
  neq: (actual, expected) => actual !== expected,
  "count-eq": (actual, expected) => Array.isArray(actual) && actual.length === expected,
  "count-gte": (actual, expected) =>
    Array.isArray(actual) && typeof expected === "number" && actual.length >= expected,
};

/**
 * Evaluate one assertion against a parsed response: what the live instance
 * actually holds, not what the agent said it did. `path` may list alternatives
 * (a field the CLI spells two ways); the first that resolves wins, so an
 * assertion tracks the capability, not one spelling.
 */
export function evalAssertion(
  response: Json,
  assertion: Assertion,
): { readonly passed: boolean; readonly actual: string } {
  const paths = typeof assertion.path === "string" ? [assertion.path] : assertion.path;
  const actual = paths
    .map((path) => resolvePath(response, path))
    .find((candidate) => candidate !== undefined);
  return {
    passed: SATISFIES[assertion.op]?.(actual, assertion.value) ?? false,
    actual: Array.isArray(actual) ? `len ${actual.length}` : JSON.stringify(actual),
  };
}

function loadAsserts(dir: string, stageId: number): ReadonlyArray<CheckResult> | undefined {
  const text = readIfPresent(join(dir, `asserts-stage${stageId}.json`));
  if (text === "") {
    return undefined;
  }
  try {
    return (JSON.parse(text) as { readonly results?: ReadonlyArray<CheckResult> }).results;
  } catch {
    return undefined;
  }
}

const NO_OAUTH_CLIENT = /^\W*no\b/i;
const NAMES_PROJECT_CREDENTIALS = /project[_ ](id|secret)/i;
const LOOKED_AT_CREDENTIALS =
  /variables|\.zitadel\/secret|client[_ ]?id|client[_ ]?secret|\.env|CLIENT_ID/i;

/**
 * "Does my project have a client id and secret?" is a reasoning answer. The
 * trap: a project id and secret are not an OAuth client id and secret, and a
 * project `setup` made has no OAuth client. So the answer must say no up
 * front and name the project id and secret as what does exist.
 */
function gradeCredentialsAnswer(parsed: ParsedStage, agentRanClean: boolean): Grade {
  const looked = LOOKED_AT_CREDENTIALS.test(
    `${parsed.pairs.map((pair) => `${pair.cmd} ${pair.out}`).join(" ")} ${parsed.final}`,
  );
  if (!agentRanClean || !looked) {
    return { status: "fail", why: "did not inspect credentials / no clear answer" };
  }
  if (!NO_OAUTH_CLIENT.test(parsed.final.trim())) {
    return {
      status: "fail",
      why: "answered that the project has an OAuth client — it has a project id/secret, which is not one",
    };
  }
  return NAMES_PROJECT_CREDENTIALS.test(parsed.final)
    ? { status: "pass", why: "said no OAuth client and named the project id/secret it has" }
    : { status: "fail", why: "said no but did not name the project id/secret it does have" };
}

/**
 * Grade one stage by outcome. A stage that declares checks passes only when
 * the agent's turn did not error and every check held. A stage with none (a
 * reasoning answer) falls back to a rule by its `grade`.
 */
export function gradeStage(
  stage: Stage,
  dir: string,
  parsed: ParsedStage,
  hasProject: boolean,
): Grade {
  const agentRanClean = !(parsed.result.is_error ?? true);
  const isFirst = stage.grade === "setup";

  if ((stage.assert?.length ?? 0) > 0 || stage.app !== undefined) {
    if (!isFirst && !hasProject) {
      return {
        status: "blocked",
        why: "stage 1 produced no project, so there's nothing to assert against",
      };
    }
    const results = loadAsserts(dir, stage.id);
    if (results === undefined) {
      return {
        status: "fail",
        why: "assertions never ran (no server state captured)",
        asserts: [],
      };
    }
    const failed = results.filter((result) => !result.passed);
    if (agentRanClean && failed.length === 0) {
      return {
        status: "pass",
        why: `${results.length}/${results.length} live-instance checks passed`,
        asserts: results,
      };
    }
    return {
      status: "fail",
      why: agentRanClean
        ? `failed: ${failed.map((result) => result.name).join("; ")}`
        : "the agent's turn errored",
      asserts: results,
    };
  }

  if (!isFirst && !hasProject) {
    return { status: "blocked", why: "stage 1 produced no project, so there's nothing to act on" };
  }
  return stage.grade === "inspect-credentials"
    ? gradeCredentialsAnswer(parsed, agentRanClean)
    : { status: "fail", why: `no assertions and no fallback rule for "${stage.grade}"` };
}

const stagesRun = (dir: string): ReadonlySet<number> | undefined => {
  const text = readIfPresent(join(dir, "stages-run.json"));
  return text === "" ? undefined : new Set(JSON.parse(text) as ReadonlyArray<number>);
};

/**
 * Grade every stage of a run. Later stages need the project stage 1 built, not
 * a clean stage 1: by convention its first check is "a project exists", so a
 * failed in-app check does not block everything downstream. A run that chose a
 * subset of stages records which, and the rest are skipped, not failed.
 */
export function gradeConfig(dir: string, stages: ReadonlyArray<Stage>): ReadonlyArray<GradedStage> {
  const selected = stagesRun(dir);
  const parsedByStage = new Map(
    stages.map((stage) => [stage.id, parseStage(join(dir, `stage${stage.id}.jsonl`))] as const),
  );
  const [first] = stages;
  const firstGrade =
    first === undefined
      ? undefined
      : gradeStage(first, dir, parsedByStage.get(first.id) as ParsedStage, true);
  const hasProject = firstGrade?.status === "pass" || Boolean(firstGrade?.asserts?.[0]?.passed);

  return stages.map((stage) => {
    const parsed = parsedByStage.get(stage.id) as ParsedStage;
    const grade: Grade =
      selected !== undefined && !selected.has(stage.id)
        ? { status: "skipped", why: "not selected for this run" }
        : gradeStage(stage, dir, parsed, hasProject);
    return {
      ...grade,
      stage: stage.id,
      title: stage.title,
      parsed,
      tokens: tokens(parsed.result),
      turns: parsed.result.num_turns ?? "?",
      ms: parsed.result.duration_ms ?? 0,
    };
  });
}
