import { NextPatcher } from "./rule/next";
import type { Patcher } from "./types";

/**
 * Active patchers, in priority order; the first whose `canPatch` matches wins.
 *
 * Patchers are grouped by family under subdirectories: `rule/` holds the
 * deterministic, template-driven patchers (extending
 * {@link import("./rule/base").AbstractRulePatcher}). A future LLM-driven
 * family lives under `llm/` and registers its concrete patchers here — no
 * orchestrator or command changes needed. Only Next.js is supported today.
 */
export const patchers = [new NextPatcher()] as const satisfies ReadonlyArray<Patcher>;
