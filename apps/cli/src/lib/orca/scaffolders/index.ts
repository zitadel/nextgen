import { AngularScaffolder } from "./angular";
import { NextScaffolder } from "./next";
import { NuxtScaffolder } from "./nuxt";
import { QwikScaffolder } from "./qwik";
import { ReactScaffolder } from "./react";
import { SolidScaffolder } from "./solid";
import { SvelteScaffolder } from "./svelte";
import { VueScaffolder } from "./vue";
import type { Scaffolder } from "./types";

/**
 * Active scaffolders, in priority order. The framework picker derives its
 * choices from this list. Add a new framework by appending its scaffolder
 * here — no orchestrator changes needed.
 */
export const scaffolders = [
  new NextScaffolder(),
  new NuxtScaffolder(),
  new ReactScaffolder(),
  new VueScaffolder(),
  new SolidScaffolder(),
  new SvelteScaffolder(),
  new QwikScaffolder(),
  new AngularScaffolder(),
] as const satisfies ReadonlyArray<Scaffolder>;
