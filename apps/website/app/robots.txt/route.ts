import { robotsTxt } from "../crawlers";

// Built with the site: Vercel sets VERCEL_ENV while it builds, and only
// production's build lets crawlers in (crawlers.ts).
export const dynamic = "force-static";

export function GET() {
  return new Response(robotsTxt(process.env.VERCEL_ENV === "production"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
