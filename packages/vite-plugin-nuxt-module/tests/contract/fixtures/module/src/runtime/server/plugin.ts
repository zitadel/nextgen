import { setResponseHeader } from "h3";
import { defineNitroPlugin } from "nitropack/runtime";

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("beforeResponse", (event) => {
    setResponseHeader(event, "x-hello-plugin", "1");
  });
});
