import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/spacious/page";
import { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OpenAPIPage } from "@/components/api-page";
import { Feedback } from "@/components/feedback";
import { MarkdownPage } from "@/components/markdown-page";
import { getMDXComponents, MdxLink } from "@/components/mdx";
import { Operations } from "@/components/operations";
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from "@/lib/shared";
import { openapiPageProps, operationTable, source } from "@/lib/source";

// Every docs page is known at build time. Unknown slugs must use the fully
// prerendered root 404: an on-demand Next error can require inline script
// just to reveal its content, which the fallback policy deliberately blocks.
export const dynamicParams = false;

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const markdownUrl = getPageMarkdownUrl(page).url;
  const header = (
    <>
      <DocsTitle>{page.data.title}</DocsTitle>
      {/* A generated reference page's body shows its whole description, so
          its header is the title, as in Fumadocs' OpenAPI recipe
          (lib/description.ts). */}
      {page.type === "docs" && (
        <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      )}
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          // A generated page has no file of its own.
          githubUrl={
            page.type === "docs"
              ? `https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${page.path}`
              : undefined
          }
        />
      </div>
    </>
  );

  if (page.type === "openapi") {
    return (
      <DocsPage full>
        {header}
        <DocsBody>
          <OpenAPIPage {...openapiPageProps(page)} />
        </DocsBody>
        <Feedback />
      </DocsPage>
    );
  }

  if (page.type === "cli" || page.type === "errors") {
    return (
      <DocsPage toc={page.data.toc}>
        {header}
        <DocsBody>
          <MarkdownPage markdown={page.data.markdown} />
        </DocsBody>
        <Feedback />
      </DocsPage>
    );
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      {header}
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page, MdxLink),
            // An API tag's page lists the tag's operations.
            Operations: () => <Operations markdown={operationTable(page)} />,
          })}
        />
      </DocsBody>
      <Feedback />
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      images: getPageImageUrl(page).url,
    },
  };
}
