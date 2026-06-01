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
        runtime: "getProxyPath()",
        imports: [{ name: "getProxyPath", importPath: "../../runtime/base-url" }],
      },
      formatter: "oxfmt",
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
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
