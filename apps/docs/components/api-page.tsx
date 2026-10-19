"use client";
import { createCodeUsageGeneratorRegistry } from "fumadocs-openapi/requests/generators";
import { curl } from "fumadocs-openapi/requests/generators/curl";
import { createOpenAPIPage } from "fumadocs-openapi/ui";

import { codeThemes } from "@/lib/code-theme";
import { sdkSample } from "@/lib/sdk-sample";

// The request and response samples in the console's colours, like the pages'
// code blocks. An operation's samples are its call through @zitadel/api, the
// client the SDK pages document (lib/sdk-sample.ts), then cURL: an empty
// registry leaves out Fumadocs' plain HTTP in the languages Zitadel ships no
// SDK for.
export const OpenAPIPage = createOpenAPIPage({
  shikiOptions: { themes: codeThemes },
  codeUsages: createCodeUsageGeneratorRegistry(),
  generateCodeSamples: ({ operation, path, pathItem }) => [
    {
      id: "typescript",
      lang: "ts",
      label: "TypeScript",
      source: (request) => sdkSample(operation, path, pathItem, request),
    },
    { id: "curl", lang: curl.lang, label: curl.label, source: curl.generate },
  ],
});
