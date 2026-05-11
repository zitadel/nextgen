import { defineConfig } from "orval";

export default defineConfig({
  zitadel: {
    input: {
      target: "../../api/openapi/openapi-spec.yaml",
    },
    output: {
      target: "./src/generated/endpoints/client.ts",
      schemas: "./src/generated/model",
      client: "fetch",
      mode: "split",
      mock: true,
      baseUrl: {
        runtime: "getApiBaseUrl()",
        imports: [{ name: "getApiBaseUrl", importPath: "../../runtime/base-url" }],
      },
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
      },
    },
  },
});
