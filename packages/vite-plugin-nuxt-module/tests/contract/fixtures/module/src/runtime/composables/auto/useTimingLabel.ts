import { useRuntimeConfig } from "#imports";
import { builtBy } from "virtual:hello-timing";

declare const __HELLO_TIMING_BUILD__: string;

/** The `Server-Timing` metric name, the build constant and the Vite plugin's export, the way the page shows them. */
export function useTimingLabel(): string {
  return `${useRuntimeConfig().public.helloTiming.timingLabel}:${__HELLO_TIMING_BUILD__}:${builtBy}`;
}
