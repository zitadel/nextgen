// @ts-nocheck
// TS 6 currently crashes while checking the Fumapress config chain.
import path from "node:path";
import { mcpPlugin } from "@fumapress/ai";
import { createOpenAPI } from "fumadocs-openapi/server";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { defineConfig } from "fumapress";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { openapiPlugin } from "fumapress/plugins/openapi";

import { docs } from "./.source/server";
import { pageToFlexsearchIndex, pageToLLMText, pageToMcpIndex } from "./src/lib/llm-text";

const openapi = createOpenAPI({
  input: [path.resolve("./.generated/openapi.yaml")],
});

export default defineConfig({
  content: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "reference/api",
    }),
  },
  site: {
    name: "Zitadel Preview Docs",
    baseUrl: import.meta.env.DEV ? "http://localhost:3003" : "https://zitadel.com/docs/preview",
    git: {
      user: "zitadel",
      repo: "nextgen",
      branch: "main",
    },
  },
})
  .plugins(
    flexsearchPlugin({
      buildIndex: pageToFlexsearchIndex,
    }),
    llmsPlugin({
      getLLMText: pageToLLMText,
    }),
    openapiPlugin({ server: openapi }),
    mcpPlugin({
      path: "/mcp",
      server: {
        name: "Zitadel Preview Docs",
        version: "0.0.1",
      },
      pageToIndex: pageToMcpIndex,
    }),
  )
  .adapters(fumadocsMdx());
