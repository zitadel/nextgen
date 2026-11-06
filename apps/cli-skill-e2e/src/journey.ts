import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

import { packageRoot } from "./paths.ts";

export type Operation = "exists" | "eq" | "neq" | "count-eq" | "count-gte";

/** A read against the live instance and what its answer must look like. */
export interface Assertion {
  readonly name: string;
  readonly get: string;
  readonly path: string | ReadonlyArray<string>;
  readonly op: Operation;
  readonly value?: unknown;
}

/** One question a developer asks, and how its outcome is verified. */
export interface Stage {
  readonly id: number;
  readonly title: string;
  readonly grade: string;
  readonly prompt: string;
  /** Persona for the simulated developer; a stage without one is a single agent turn. */
  readonly user?: string;
  /** A browser check run against the scaffolded app. */
  readonly app?: string;
  readonly assert?: ReadonlyArray<Assertion>;
}

export interface Journey {
  readonly cliSpec?: string;
  readonly stages: ReadonlyArray<Stage>;
}

/** The journey as `journey.yaml` defines it. */
export function loadJourney(): Journey {
  return parse(readFileSync(join(packageRoot, "journey.yaml"), "utf8")) as Journey;
}
