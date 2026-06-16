import { qwikVite } from "@builder.io/qwik/optimizer";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [qwikVite()],
  resolve: {
    // Use the browser build so Qwik's client `render()` works under jsdom.
    conditions: ["browser"],
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
