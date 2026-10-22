import { useRuntimeConfig } from "#imports";
import { greetingFor } from "../../shared";

/** A greeting for `name`, in the greeting the app configured. */
export function useGreeting(name: string): string {
  return greetingFor(name, useRuntimeConfig().public.helloTiming.greeting);
}
