import { defineConfig } from "orval";

export default defineConfig({
  zitadel: {
    input: {
      target: "../../api/openapi/openapi-spec.yaml",
    },
    output: {
      target: "./src/generated/endpoints",
      schemas: "./src/generated/model",
      client: "fetch",
      mode: "split",
      mock: true,
      baseUrl: {
        runtime: "getApiBaseUrl()",
        imports: [{ name: "getApiBaseUrl", importPath: "../../runtime/base-url" }],
      },
      formatter: "oxfmt",
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          // Every generated operation routes through `customFetch` so
          // bearer auth, non-2xx → throw, and JSON body parsing happen
          // in one place. Callers consume the orval functions directly
          // — no hand-written HTTP wrapper.
          path: "./src/runtime/fetch.ts",
          name: "customFetch",
        },
      },
    },
  },
  zitadelZod: {
    input: {
      target: "../../api/openapi/openapi-spec.yaml",
    },
    output: {
      mode: "split",
      client: "zod",
      target: "./src/generated/endpoints",
      fileExtension: ".zod.ts",
      formatter: "oxfmt",
      clean: ["!**/*", "./src/generated/endpoints/**/*.zod.ts"],
    },
  },
});
