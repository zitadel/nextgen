// @ts-nocheck
// TS 6 currently crashes while checking the Fumapress config chain.
import { mcpPlugin } from "@fumapress/ai";
import { createOpenAPI } from "fumadocs-openapi/server";
import { fumadocsMdx } from "fumapress/adapters/mdx";
import { defineConfig } from "fumapress";
import { createRootLayout } from "fumapress/layouts/root";
import { flexsearchPlugin } from "fumapress/plugins/flexsearch";
import { llmsPlugin } from "fumapress/plugins/llms.txt";
import { openapiPlugin } from "fumapress/plugins/openapi";

import openapiDocument from "./.generated/openapi.mjs";
import { docs } from "./.source/server";
import { pageToFlexsearchIndex, pageToLLMText, pageToMcpIndex } from "./src/lib/llm-text";

const openapi = createOpenAPI({
  input: {
    "zitadel-nextgen": openapiDocument,
  },
});

export default defineConfig({
  content: {
    docs: docs.toFumadocsSource(),
    openapi: await openapi.staticSource({
      baseDir: "reference/api",
      groupBy: "tag",
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
  .layouts({
    // Dark-only docs (ADR 014 §5). `createRootLayout()` is the default root factory
    // (fumapress/layouts/root) — re-creating it here only adds the forced theme.
    root: createRootLayout({
      providerProps: {
        theme: { defaultTheme: "dark", forcedTheme: "dark" },
      },
    }),
    // The theme is forced, so hide the now-inert light/dark switch.
    defaultProps: () => ({ themeSwitch: { enabled: false } }),
  })
  .adapters(fumadocsMdx());
