import { greetingFor } from "../../../shared";

/** A greeting for `name`, available to every Nitro handler without an import. */
export function helloGreeting(name = "server"): string {
  return greetingFor(name);
}
