import { docsLlms, source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  // Every page but the API's operations and webhooks: with the schemas they
  // reference they would make this file twenty times its size. llms.txt lists
  // them, and each has its own .md.
  const pages = source.getPages().filter((page) => page.type !== "openapi");
  const rendered = await Promise.all(pages.map((page) => docsLlms.page(page)));

  return new Response(rendered.join("\n\n"));
}
