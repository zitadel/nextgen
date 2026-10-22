import { defineEventHandler, setResponseHeader } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";
import { TIMING_HEADER, timingHeader } from "../../../server";

export default defineEventHandler((event) => {
  const started = performance.now();
  const label = useRuntimeConfig(event).public.helloTiming.timingLabel;
  setResponseHeader(event, TIMING_HEADER, timingHeader(label, performance.now() - started));
});
