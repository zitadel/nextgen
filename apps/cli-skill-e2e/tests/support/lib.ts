import type { CheckResult } from "./agent-client";
import type { Stage } from "./journey";

// The grading helpers are plain JS so the report script shares them.
// @ts-expect-error — no types for the shared helper
import * as lib from "../../scripts/lib.mjs";

export interface Grade {
  status: "pass" | "fail" | "blocked" | "skipped";
  why: string;
  asserts?: CheckResult[];
}

export const evalAssertion = lib.evalAssertion as (
  parsed: unknown,
  assertion: NonNullable<Stage["assert"]>[number],
) => { passed: boolean; actual: string };

export const parseStage = lib.parseStage as (file: string) => unknown;

export const gradeStage = lib.gradeStage as (
  stage: Stage,
  dir: string,
  parsed: unknown,
  stage1ok: boolean,
) => Grade;

export const gradeConfig = lib.gradeConfig as (
  dir: string,
  stages: Stage[],
) => Array<Grade & { stage: number }>;
