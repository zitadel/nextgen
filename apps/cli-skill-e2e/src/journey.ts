import { readdirSync, readFileSync } from "node:fs";
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

/** An app check with the parameters it needs, such as which pages are meant to be protected. */
export interface AppCheckSpec {
  readonly check: string;
  readonly [parameter: string]: unknown;
}

/** One question a developer asks, and how its outcome is verified. */
export interface Stage {
  readonly id: number;
  readonly title: string;
  readonly grade: string;
  readonly prompt: string;
  /** Persona for the simulated developer; a stage without one is a single agent turn. */
  readonly user?: string;
  /** A shell command run in the workspace before the agent's turn, to set a situation up. */
  readonly prepare?: string;
  /** A browser check run against the app, by name or with the parameters it takes. */
  readonly app?: string | AppCheckSpec;
  readonly assert?: ReadonlyArray<Assertion>;
}

/** An app that already exists: a folder under `fixtures/`, committed and installed before the journey starts. */
export interface StartingPoint {
  readonly fixture: string;
  readonly install: string;
}

export interface Journey {
  /** The journey's name: its file name, without the extension. */
  readonly name: string;
  readonly cliSpec?: string;
  /** Without one, the agent starts in an empty folder. */
  readonly start?: StartingPoint;
  readonly stages: ReadonlyArray<Stage>;
}

const journeysDir = join(packageRoot, "journeys");

/** The names of the journeys in `journeys/`. */
export const journeyNames = (): ReadonlyArray<string> =>
  readdirSync(journeysDir)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => file.replace(/\.yaml$/, ""))
    .sort();

/** One journey, as `journeys/<name>.yaml` defines it. */
export function loadJourney(name: string): Journey {
  const definition = parse(readFileSync(join(journeysDir, `${name}.yaml`), "utf8")) as Omit<
    Journey,
    "name"
  >;
  return { ...definition, name };
}
