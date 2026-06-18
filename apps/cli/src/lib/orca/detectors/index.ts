import { AngularDetector } from "./angular";
import { NextDetector } from "./next";
import { NuxtDetector } from "./nuxt";
import { QwikDetector } from "./qwik";
import { ReactDetector } from "./react";
import { SolidDetector } from "./solid";
import { SvelteDetector } from "./svelte";
import { VueDetector } from "./vue";
import type { Detector } from "./types";

/**
 * Active detectors, in probe order. The orchestrator tries each until one
 * recognises the project. Add a framework by appending its detector here — no
 * orchestrator changes needed. Meta-frameworks run before their base: Next
 * before React (Next ships React), and the Vue detector excludes Nuxt — so a
 * Next/Nuxt project is never mistaken for a bare React/Vue SPA.
 */
export const detectors = [
  new NextDetector(),
  new NuxtDetector(),
  new ReactDetector(),
  new VueDetector(),
  new SolidDetector(),
  new SvelteDetector(),
  new QwikDetector(),
  new AngularDetector(),
] as const satisfies ReadonlyArray<Detector>;
