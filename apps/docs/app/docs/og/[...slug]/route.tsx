import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";

import { cardLayout, lineHeight } from "@/lib/og-layout";
import { appName, getPageImageUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/docs/og/[...slug]">) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // Fumadocs' card, with the title sized to fit and the description clamped
  // to the room left (lib/og-layout.ts).
  const title = page.data.title ?? "";
  const { titleSize, descriptionSize, descriptionLines } = cardLayout(title);

  return generateOGImage({
    title: <span style={{ display: "block", fontSize: titleSize, lineHeight }}>{title}</span>,
    description: page.data.description && (
      <span
        style={{
          display: "block",
          fontSize: descriptionSize,
          lineHeight,
          lineClamp: descriptionLines,
        }}
      >
        {page.data.description}
      </span>
    ),
    site: appName,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
