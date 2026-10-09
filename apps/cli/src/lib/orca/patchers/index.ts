import { AngularPatcher } from "./rule/angular";
import { NextPatcher } from "./rule/next";
import { NuxtPatcher } from "./rule/nuxt";
import { QwikPatcher } from "./rule/qwik";
import { QwikCityPatcher } from "./rule/qwik-city";
import { ReactPatcher } from "./rule/react";
import { SolidPatcher } from "./rule/solid";
import { SolidStartPatcher } from "./rule/solid-start";
import { SveltePatcher } from "./rule/svelte";
import { SvelteKitPatcher } from "./rule/sveltekit";
import { TanStackStartPatcher } from "./rule/tanstack-start";
import { VuePatcher } from "./rule/vue";
import type { Patcher } from "./types";

/**
 * Active patchers, in priority order; the first whose `canPatch` matches wins.
 *
 * Patchers are grouped by family under subdirectories: `rule/` holds the
 * deterministic, template-driven patchers (extending
 * {@link import("./rule/base").AbstractRulePatcher}). A future LLM-driven
 * family lives under `llm/` and registers its concrete patchers here — no
 * orchestrator or command changes needed.
 */
export const patchers = [
  new NextPatcher(),
  new NuxtPatcher(),
  new TanStackStartPatcher(),
  new ReactPatcher(),
  new VuePatcher(),
  new SolidStartPatcher(),
  new SolidPatcher(),
  new SvelteKitPatcher(),
  new SveltePatcher(),
  new QwikCityPatcher(),
  new QwikPatcher(),
  new AngularPatcher(),
] as const satisfies ReadonlyArray<Patcher>;
