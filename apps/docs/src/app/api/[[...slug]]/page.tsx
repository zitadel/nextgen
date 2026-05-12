import { apiSource } from "@/lib/source";
import { APIPage } from "@/components/api-page";
import { DocsPage, DocsBody, DocsTitle } from "fumadocs-ui/page";
import { notFound } from "next/navigation";
import type { OpenAPIPageData } from "fumadocs-openapi/server";
import Link from "next/link";

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

/**
 * API reference page — auto-generated from the OpenAPI spec.
 *
 * Each endpoint gets its own page with:
 * - Method badge + path
 * - Parameter tables
 * - Request/response schemas
 * - Tabbed code examples (curl, JS, Go, Python, Java, C#, ZITADEL CLI)
 */
export default async function APIReferencePage({ params }: PageProps) {
  const { slug } = await params;

  // Index page — list all endpoints
  if (!slug || slug.length === 0) {
    const pages = apiSource.getPages();
    return (
      <DocsPage>
        <DocsTitle>API Reference</DocsTitle>
        <DocsBody>
          <p className="text-fd-muted-foreground">
            Auto-generated from the OpenAPI 3.1 specification. Each endpoint
            includes curl, JavaScript, Go, Python, Java, and C# code examples.
          </p>
          <div className="mt-6 grid gap-3">
            {pages.map((page) => (
              <Link
                key={page.url}
                href={page.url}
                className="flex items-center gap-3 rounded-lg border border-fd-border p-4 transition-colors hover:bg-fd-accent"
              >
                <span className="text-sm font-medium">{page.data.title}</span>
                {page.data._openapi?.method && (
                  <span className="rounded-md bg-fd-primary/10 px-2 py-0.5 text-xs font-semibold uppercase text-fd-primary">
                    {page.data._openapi.method}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </DocsBody>
      </DocsPage>
    );
  }

  // Endpoint detail page
  const page = apiSource.getPage(slug);
  if (!page) notFound();

  const data = page.data as OpenAPIPageData;

  return (
    <DocsPage toc={data.toc}>
      <DocsTitle>{data.title}</DocsTitle>
      <DocsBody>
        <APIPage {...data.getAPIPageProps()} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return apiSource.generateParams();
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;

  if (!slug || slug.length === 0) {
    return {
      title: "API Reference",
      description:
        "ZITADEL NextGen API reference — auto-generated from OpenAPI 3.1",
    };
  }

  const page = apiSource.getPage(slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
