import { defineConfig } from "orval";

/**
 * Both generators read the same spec. `api/openapi/` is deliberately split
 * one file per endpoint (see api/openapi/AGENTS.md), so the root document is
 * almost entirely `$ref`s into sibling files. orval 8.37 stopped following
 * external `$ref`s unless they are allow-listed — a fetch guard aimed at
 * remote documents. Every target here is a local file in this repo, checked
 * in beside the root, so allowing all of them adds no network reach.
 */
const input = {
  target: "../../api/openapi/openapi-spec.yaml",
  parserOptions: {
    externalRefs: {
      allow: ["*"],
    },
  },
};

export default defineConfig({
  zitadel: {
    input,
    output: {
      target: "./src/generated/endpoints",
      schemas: "./src/generated/model",
      client: "fetch",
      mode: "split",
      mock: true,
      // A path parameter is any string the API accepts, and schema ids are
      // routinely `$id` URIs (`https://…/default-human-user.json`). Without
      // this, orval interpolates them raw and `/schemas/{id}` collapses the
      // `//` on a redirect and 404s. orval only encodes the parameters —
      // not the `baseUrl` below — from 8.37.0 (orval-labs/orval#4179).
      urlEncodeParameters: true,
      baseUrl: {
        runtime: "getProxyPath()",
        imports: [{ name: "getProxyPath", importPath: "../../runtime/base-url" }],
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
    input,
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
