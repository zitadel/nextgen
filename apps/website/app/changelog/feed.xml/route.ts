import { entryPath, readChangelog } from "../entries";

// The changelog as an Atom feed, built with the site (entries.ts): each
// entry's title, when it landed and its summary, which is plain text, linked
// to its page, so no Markdown is rendered into HTML here (markdown.tsx). An
// Atom feed's links are absolute: the cloud's production host, which a
// preview deployment's feed links to as well.
export const dynamic = "force-static";

const ORIGIN = "https://preview.zitadel.com";

/** How many entries the feed carries, the newest. */
const IN_FEED = 50;

export function GET() {
  const entries = readChangelog().entries.slice(0, IN_FEED);
  const index = `${ORIGIN}/changelog`;
  const updated = (date: string) => new Date(date).toISOString();
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    "  <title>Zitadel preview changelog</title>",
    "  <subtitle>What's new in the Zitadel preview.</subtitle>",
    `  <link rel="self" href="${index}/feed.xml"/>`,
    `  <link rel="alternate" type="text/html" href="${index}"/>`,
    `  <id>${index}</id>`,
    `  <updated>${updated(entries[0]?.date ?? "2026-10-21")}</updated>`,
    "  <author><name>Zitadel</name></author>",
    ...entries.flatMap((entry) => {
      const url = `${ORIGIN}${entryPath(entry.slug)}`;
      return [
        "  <entry>",
        `    <title>${xmlText(entry.title)}</title>`,
        `    <link rel="alternate" type="text/html" href="${url}"/>`,
        `    <id>${url}</id>`,
        `    <updated>${updated(entry.date)}</updated>`,
        `    <summary>${xmlText(entry.summary)}</summary>`,
        "  </entry>",
      ];
    }),
    "</feed>",
    "",
  ].join("\n");
  return new Response(xml, { headers: { "content-type": "application/atom+xml; charset=utf-8" } });
}

function xmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
