/** A `Server-Timing` header value: `hello;dur=0.4`. The module's `./server` sub-export, for the app's own Nitro code. */
export function timingHeader(label: string, milliseconds: number): string {
  return `${label};dur=${milliseconds.toFixed(1)}`;
}

/** The shared header every response of the module carries. */
export const TIMING_HEADER = "Server-Timing";
