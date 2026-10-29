import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";

import { nonceHeader } from "@/lib/csp";
import "./global.css";

// The console's faces: Arimo for text, APK Futural (a licensed webfont, Regular
// only) for headings, both from ./fonts so the build fetches nothing
// (AGENTS.md). next/font serves them from /docs/_next/, like every asset of
// this app; global.css hands them to Tailwind and Fumadocs.
//
// Arimo is one variable file, every weight from 400 to 700.
const arimo = localFont({
  src: "./fonts/Arimo-latin.woff2",
  weight: "400 700",
  variable: "--font-arimo",
});

const apkFutural = localFont({
  src: "./fonts/APK-Futural-Regular.woff2",
  weight: "400",
  variable: "--font-apk-futural",
});

export const metadata: Metadata = {
  icons: favicons(),
};

// The hosted cloud's favicons, which the website serves at /favicons/
// (apps/website/AGENTS.md), declared as the website declares them: a dark
// mark for a light browser, a light one for a dark browser. Outside the
// cloud nothing serves them.
function favicons(): Metadata["icons"] {
  const schemes = ["light", "dark"].map((scheme) => ({
    dir: `/favicons/${scheme}`,
    media: `(prefers-color-scheme: ${scheme})`,
  }));
  return {
    icon: schemes.flatMap(({ dir, media }) => [
      { url: `${dir}/favicon-16x16.png`, sizes: "16x16", type: "image/png", media },
      { url: `${dir}/favicon-32x32.png`, sizes: "32x32", type: "image/png", media },
      { url: `${dir}/favicon.ico`, type: "image/x-icon", media },
    ]),
    shortcut: schemes.map(({ dir, media }) => ({
      url: `${dir}/favicon.ico`,
      type: "image/x-icon",
      media,
    })),
    apple: schemes.map(({ dir, media }) => ({
      url: `${dir}/apple-touch-icon.png`,
      sizes: "180x180",
      type: "image/png",
      media,
    })),
  };
}

// Unset reports every page load; next.config.mjs rejects a value outside 0–1.
// Web Analytics has no sampling and counts every page view.
const speedInsightsSampleRate = Number(process.env.DOCS_SPEED_INSIGHTS_SAMPLE_RATE || 1);

export default async function Layout({ children }: LayoutProps<"/">) {
  // The page's nonce (proxy.ts), for the theme's inline script; Next.js gives
  // its own scripts the nonce itself. Reading it renders every page per
  // request.
  const nonce = (await headers()).get(nonceHeader) ?? undefined;
  return (
    <html lang="en" className={`${arimo.variable} ${apkFutural.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          // The search route lives under /docs, like every other route.
          search={{ options: { api: "/docs/api/search" } }}
          // Fumadocs styles the dark theme by the class; the design tokens
          // switch on data-theme, as in the console. Set both.
          theme={{ attribute: ["class", "data-theme"], nonce }}
        >
          {children}
        </RootProvider>
        <Analytics />
        {/* The package reads a rate of 0 as unset, which would send every
            page load. */}
        {speedInsightsSampleRate > 0 && <SpeedInsights sampleRate={speedInsightsSampleRate} />}
      </body>
    </html>
  );
}
