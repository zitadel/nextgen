import { openapi } from "@/lib/source";
import { createAPIPage } from "fumadocs-openapi/ui";
import { codeUsages } from "@/lib/code-usage";
import { highlight } from "fumadocs-core/highlight";
import { CodeBlock } from "fumadocs-ui/components/codeblock";

/**
 * API reference page component using fumadocs-openapi.
 *
 * Uses a custom `renderCodeBlock` with server-side Shiki highlighting
 * to avoid hydration mismatches caused by the client-side DynamicCodeBlock
 * rendering code examples with a different base URL than the server.
 */
export const APIPage = createAPIPage(openapi, {
  codeUsages,
  renderCodeBlock: async ({ lang, code }) => {
    const rendered = await highlight(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
    });

    return <CodeBlock className="my-0">{rendered}</CodeBlock>;
  },
  playground: {
    render() {
      // Playground disabled — the OpenAPI spec uses $ref for parameters
      // which causes resolution issues in the playground client component.
      return null;
    },
  },
});
