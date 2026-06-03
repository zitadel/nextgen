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
      override: {
        zod: {
          // Reject unknown keys on query/header schemas (where the spec
          // is exhaustive and typos can't be legitimate). Leave the
          // others passthrough:
          //
          // - body/response — the user-schema endpoint accepts JSON
          //   Schema bodies (`$schema`, `$id`, `type`, `title`,
          //   `required`, …) the OpenAPI spec deliberately doesn't
          //   enumerate keyword-by-keyword. Strict here would reject
          //   those legitimate JSON Schema keywords as unknown.
          // - param — msw's path-param object carries a numeric `"0"`
          //   wildcard key alongside the named segments, which strict
          //   mode would also flag; and if the URL doesn't match the
          //   pattern the request never reaches the handler in the
          //   first place, so strict on path params is bargain-bin
          //   value.
          strict: {
            response: false,
            body: false,
            param: false,
            query: true,
            header: true,
          },
        },
      },
    },
  },
});
