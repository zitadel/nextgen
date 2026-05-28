import { NextPatcher } from "./next";
import type { Patcher } from "./types";

/**
 * Active patchers, in priority order; the first whose `canPatch` matches wins.
 *
 * Extension seam: a future LLM-driven patcher (for Nuxt, Vue, Astro, …) is a
 * new {@link Patcher} appended here — no orchestrator or command changes
 * needed. Only Next.js is supported deterministically today.
 */
export const patchers = [new NextPatcher()] as const satisfies ReadonlyArray<Patcher>;
