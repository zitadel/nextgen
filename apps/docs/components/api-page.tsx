"use client";
import { createOpenAPIPage } from "fumadocs-openapi/ui";

import { codeThemes } from "@/lib/code-theme";

// The request and response samples in the console's colours, like the pages'
// code blocks.
export const OpenAPIPage = createOpenAPIPage({ shikiOptions: { themes: codeThemes } });
