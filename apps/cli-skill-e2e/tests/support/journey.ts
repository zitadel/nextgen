// The loader is plain JS so the report script shares it.
// @ts-expect-error — no types for the shared loader
import { loadJourney } from "../../scripts/journey.mjs";

/** One question a developer asks, and how its outcome is verified. */
export interface Stage {
  id: number;
  title: string;
  grade: string;
  prompt: string;
  /** Persona for the simulated developer; a stage without one is a single agent turn. */
  user?: string;
  /** Reads against the live instance. */
  assert?: Array<{
    name: string;
    get: string;
    path: string | string[];
    op: string;
    value?: unknown;
  }>;
  /** A browser check run against the scaffolded app. */
  app?: string;
}

export interface Journey {
  cliSpec?: string;
  stages: Stage[];
}

export const journey = loadJourney() as Journey;
