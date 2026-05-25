import { NextScaffolder } from "./next";
import type { Scaffolder } from "./types";

/** All active scaffolders. The framework picker derives its choices from this list. */
export const scaffolders: Scaffolder[] = [
  new NextScaffolder(),
  // new BetterTStackScaffolder(),
  // new VueScaffolder(),
  // new GitCloneScaffolder(),
  // new LLMScaffolder(),
];
