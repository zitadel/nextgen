import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { apiMockPublicDir } from "@zitadel/api-mock/public-dir";

// The service worker the live examples mock the Flow API in
// (components/examples/mock.ts): MSW's, as @zitadel/api-mock ships it for the
// msw it runs on. From /docs/ its scope stays inside the docs: the browser
// keeps a worker inside the path its script comes from.
export const revalidate = false;

export async function GET() {
  const script = await readFile(join(apiMockPublicDir, "mockServiceWorker.js"), "utf8");
  return new Response(script, { headers: { "Content-Type": "text/javascript; charset=utf-8" } });
}
