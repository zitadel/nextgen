import { notFound } from "next/navigation";

import { absoluteDocsLinks, cdnCached } from "@/lib/absolute-links";
import { docsLlms, source } from "@/lib/source";

export async function GET(
  request: Request,
  { params }: RouteContext<"/llms.mdx/docs/[[...slug]]">,
) {
  const { slug } = await params;
  // remove the appended "content.md", `/docs/index.md` is rewritten to the root page
  const slugs = slug?.slice(0, -1) ?? [];
  if (slugs.at(-1) === "index") slugs.pop();
  const page = source.getPage(slugs);
  if (!page) notFound();

  return new Response(absoluteDocsLinks(await docsLlms.page(page), request), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      ...cdnCached,
    },
  });
}
