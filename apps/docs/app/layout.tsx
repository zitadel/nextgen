import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import "./global.css";

// The faces of fumadocs.dev.
const geist = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
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

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          // The search route lives under /docs, like every other route.
          search={{ options: { api: "/docs/api/search" } }}
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
