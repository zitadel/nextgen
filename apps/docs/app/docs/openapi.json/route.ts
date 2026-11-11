// The whole OpenAPI document the API reference is generated from
// (lib/openapi.ts), for client generators, API tools and agents.
import openapiDocument from "@/.generated/openapi.mjs";
import { absoluteDocsLinks, cdnCached } from "@/lib/absolute-links";

const body = JSON.stringify(openapiDocument);

export function GET(request: Request) {
  return new Response(absoluteDocsLinks(body, request), {
    headers: { "content-type": "application/json", ...cdnCached },
  });
}
