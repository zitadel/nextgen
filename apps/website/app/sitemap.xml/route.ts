import { readChangelog } from "../changelog/entries";
import { sitemapXml } from "../crawlers";

// Built with the site, from the changelog's entries (entries.ts).
export const dynamic = "force-static";

export function GET() {
  return new Response(sitemapXml(readChangelog().entries), {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}
