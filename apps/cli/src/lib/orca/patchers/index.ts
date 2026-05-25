import { LegacyPatcher } from "./legacy";
import { LLMPatcher } from "./llm";
import type { Patcher } from "./types";

/** All active patchers, in priority order. The first that canPatch() wins. */
export const patchers: Patcher[] = [
  new LegacyPatcher(),
  new LLMPatcher(),
];
