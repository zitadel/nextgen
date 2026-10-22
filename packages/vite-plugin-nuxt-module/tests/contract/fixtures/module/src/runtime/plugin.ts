import { generated } from "#hello-timing";
import { defineNuxtPlugin } from "#imports";
import { greetingFor } from "../shared";

export default defineNuxtPlugin(() => ({
  provide: { hello: greetingFor("plugin", generated.greeting) },
}));
