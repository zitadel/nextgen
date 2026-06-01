import { NextScaffolder } from "./next";
import type { Scaffolder } from "./types";

/**
 * Active scaffolders, in priority order. The framework picker derives its
 * choices from this list. Add a new framework by appending its scaffolder
 * here — no orchestrator changes needed.
 */
export const scaffolders = [new NextScaffolder()] as const satisfies ReadonlyArray<Scaffolder>;
