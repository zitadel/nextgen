// Type-checked against the types the module generated: every line must compile, and every
// `@ts-expect-error` must be needed.
import type { ModuleHooks, ModuleOptions } from "hello-timing";
import { timingHeader } from "hello-timing/server";
import { generated } from "#hello-timing";

const options: ModuleOptions = {
  greeting: "Hi",
  prefix: "/api/x",
  timingLabel: "t",
  secretPath: "/s",
  secret: "",
};
const partial: Partial<ModuleOptions> = { timingLabel: "t" };
const header: string = timingHeader("a", 1);
const greeting: string = generated.greeting;
const hook: ModuleHooks["hello-timing:setup"] = (context) => {
  context.greetings.push("typed");
};

// @ts-expect-error `greeting` is a string.
const wrongOption: ModuleOptions = { greeting: 1 };
// @ts-expect-error `timingHeader` takes a number of milliseconds.
timingHeader("a", "1");
// @ts-expect-error the generated file has no such export.
const missing: string = generated.nope;

export { greeting, header, hook, missing, options, partial, wrongOption };

const nuxtApp = useNuxtApp();
const hello: string = nuxtApp.$hello;
// @ts-expect-error `$hello` is a string.
const wrongHello: number = nuxtApp.$hello;
const runtimeConfig = useRuntimeConfig();
const publicGreetings: string[] = runtimeConfig.public.helloTiming.greetings;
const secret: string = runtimeConfig.helloTiming.secret;
export { hello, publicGreetings, secret, wrongHello };
