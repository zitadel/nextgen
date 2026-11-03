import { track } from "@vercel/analytics/server";

import { feedbackEvent, pageFeedback } from "@/lib/feedback";

// The feedback card's ratings, sent on from the server: blockers that stop
// Vercel's script in the browser (/_vercel/insights/) would drop them there.
// Outside Vercel there is no VERCEL_URL to send to, and track() only logs.
export async function POST(request: Request) {
  const feedback = pageFeedback.safeParse(await request.json().catch(() => null));
  if (!feedback.success) return new Response(null, { status: 400 });

  // The deployment URL track() posts to is protected; it sends
  // VERCEL_AUTOMATION_BYPASS_SECRET, which the project's automation bypass sets.
  // It reports this route's URL as the event's page, so Web Analytics' Pages
  // shows /docs/api/feedback; the rated page is the `page` property.
  // The header every event carries (docs/product-analytics-events.yaml) leads:
  // the surface and, on Vercel, the commit the docs were deployed from.
  const version = process.env.VERCEL_GIT_COMMIT_SHA;
  await track(
    feedbackEvent,
    { surface: "docs", ...(version ? { docs_version: version } : {}), ...feedback.data },
    { request },
  );
  return new Response(null, { status: 204 });
}
