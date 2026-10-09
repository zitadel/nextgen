import { AngularScaffolder } from "./angular";
import { NextScaffolder } from "./next";
import { NuxtScaffolder } from "./nuxt";
import { QwikScaffolder } from "./qwik";
import { QwikCityScaffolder } from "./qwik-city";
import { ReactScaffolder } from "./react";
import { SolidScaffolder } from "./solid";
import { SolidStartScaffolder } from "./solid-start";
import { SvelteScaffolder } from "./svelte";
import { SvelteKitScaffolder } from "./sveltekit";
import { TanStackStartScaffolder } from "./tanstack-start";
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
  new TanStackStartScaffolder(),
  new ReactScaffolder(),
  new VueScaffolder(),
  new SolidStartScaffolder(),
  new SolidScaffolder(),
  new SvelteKitScaffolder(),
  new SvelteScaffolder(),
  new QwikCityScaffolder(),
  new QwikScaffolder(),
  new AngularScaffolder(),
] as const satisfies ReadonlyArray<Scaffolder>;
