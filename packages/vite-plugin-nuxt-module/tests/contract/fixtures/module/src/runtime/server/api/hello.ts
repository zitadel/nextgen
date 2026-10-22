import { BUILD } from "#hello-timing/virtual";
import { defineEventHandler, getQuery } from "h3";
import { useRuntimeConfig } from "nitropack/runtime";
import { greetingFor } from "../../../shared";

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event);
  const { name = "api" } = getQuery(event);
  return {
    message: greetingFor(String(name), config.public.helloTiming.greeting),
    secretConfigured: config.helloTiming.secret !== "",
    build: BUILD !== "",
  };
});
