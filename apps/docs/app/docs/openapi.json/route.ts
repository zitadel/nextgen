// The whole OpenAPI document the API reference is generated from
// (lib/openapi.ts), for client generators, API tools and agents.
import openapiDocument from "@/.generated/openapi.mjs";

// The spec links docs pages root-relative, which resolve on the docs' pages
// but not in a downloaded document. They are made absolute against the
// origin this deployment answers on, so production, preview and local docs
// each link to themselves.
const body = JSON.stringify(openapiDocument);

export function GET(request: Request) {
  const { origin } = new URL(request.url);
  return new Response(body.replaceAll("](/docs/", `](${origin}/docs/`), {
    headers: { "content-type": "application/json" },
  });
}
