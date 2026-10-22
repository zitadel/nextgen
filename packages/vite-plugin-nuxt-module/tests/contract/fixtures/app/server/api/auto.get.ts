// `helloGreeting` and `helloUptime` are auto-imported by the module; the alias is added in `nitro:config`.
import { helloGreeting as aliased } from "#hello-timing-greeting";

export default defineEventHandler(() => ({
  greeting: helloGreeting("auto"),
  aliased: aliased("alias"),
  uptime: helloUptime(),
}));
