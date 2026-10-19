import { generateOGImage } from "fumadocs-ui/og";
import { notFound } from "next/navigation";

import { appName, getPageImageUrl } from "@/lib/shared";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<"/docs/og/[...slug]">) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // Fumadocs' card sets the title in 82px type and the description in 52px and
  // clips neither, so a long title and a long description run into each other
  // and into the site's name. It has room for two lines of title and two of
  // description, or one of title and three of description; a title of up to 22
  // characters fits on one line.
  const descriptionLines = (page.data.title?.length ?? 0) <= 22 ? 3 : 2;

  return generateOGImage({
    title: <span style={{ display: "block", lineClamp: 2 }}>{page.data.title}</span>,
    description: page.data.description && (
      <span style={{ display: "block", lineClamp: descriptionLines }}>{page.data.description}</span>
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
