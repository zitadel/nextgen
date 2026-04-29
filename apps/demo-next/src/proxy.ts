import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export async function proxy(req: NextRequest) {
  const { pathname } = new URL(req.url);

  if (pathname.startsWith("/__nextgen")) {
    const backendUrl = process.env.NEXTGEN_BACKEND_URL ?? "http://localhost:4000";
    const suffix = pathname.slice("/__nextgen".length);
    const target = new URL(suffix + new URL(req.url).search, backendUrl);

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers: new Headers(req.headers),
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual",
      // @ts-expect-error -- Node 18+ duplex option
      duplex: "half",
    });

    // Wrap in a new Response with mutable headers so Next.js can process it
    return new Response(upstream.body, {
      status: upstream.status,
      headers: new Headers(upstream.headers),
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/__nextgen/:path*"],
};
