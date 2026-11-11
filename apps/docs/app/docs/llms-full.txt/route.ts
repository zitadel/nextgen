import { absoluteDocsLinks, cdnCached } from "@/lib/absolute-links";
import { docsLlmsFull, source } from "@/lib/source";

export async function GET(request: Request) {
  // Every page but the API's operations and webhooks: with the schemas they
  // reference they would make this file twenty times its size. llms.txt lists
  // them, and each has its own .md.
  const pages = source.getPages().filter((page) => page.type !== "openapi");
  const rendered = await Promise.all(pages.map((page) => docsLlmsFull.page(page)));

  return new Response(absoluteDocsLinks(rendered.join("\n\n"), request), {
    headers: { "content-type": "text/plain; charset=utf-8", ...cdnCached },
  });
}
