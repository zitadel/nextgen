import { AngularDetector } from "./angular";
import { NextDetector } from "./next";
import { NuxtDetector } from "./nuxt";
import { QwikDetector } from "./qwik";
import { QwikCityDetector } from "./qwik-city";
import { ReactDetector } from "./react";
import { SolidDetector } from "./solid";
import { SolidStartDetector } from "./solid-start";
import { SvelteDetector } from "./svelte";
import { SvelteKitDetector } from "./sveltekit";
import { TanStackStartDetector } from "./tanstack-start";
import { VueDetector } from "./vue";
import type { Detector } from "./types";

/**
 * Active detectors, in probe order. The orchestrator tries each until one
 * recognises the project. Add a framework by appending its detector here — no
 * orchestrator changes needed. Meta-frameworks run before their base so a
 * meta-framework project is never mistaken for a bare SPA: Next before React,
 * TanStack Start before React, Nuxt before Vue (Vue excludes Nuxt), SolidStart
 * before Solid, SvelteKit before Svelte, and Qwik City before Qwik (each base
 * SPA detector excludes its meta-framework).
 */
export const detectors = [
  new NextDetector(),
  new NuxtDetector(),
  new TanStackStartDetector(),
  new ReactDetector(),
  new VueDetector(),
  new SolidStartDetector(),
  new SolidDetector(),
  new SvelteKitDetector(),
  new SvelteDetector(),
  new QwikCityDetector(),
  new QwikDetector(),
  new AngularDetector(),
] as const satisfies ReadonlyArray<Detector>;
