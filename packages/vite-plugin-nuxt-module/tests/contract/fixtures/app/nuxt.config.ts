export default defineNuxtConfig({
  modules: ["hello-timing"],
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  telemetry: false,
  helloTiming: {
    greeting: "Hello",
    timingLabel: "hello",
    secret: "s3cr3t-value",
  },
  hooks: {
    "hello-timing:setup": (context) => {
      context.greetings.push("from the app hook");
    },
  },
});
