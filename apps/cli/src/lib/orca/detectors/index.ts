import { NextDetector } from "./next";
import type { Detector } from "./types";

/**
 * Active detectors, in probe order. The orchestrator tries each until one
 * recognises the project. Add a framework by appending its detector here — no
 * orchestrator changes needed.
 */
export const detectors = [new NextDetector()] as const satisfies ReadonlyArray<Detector>;
