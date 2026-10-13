import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Arimo } from "next/font/google";
import localFont from "next/font/local";
import "./global.css";

// The console's faces: Arimo for text, APK Futural (a licensed webfont, Regular
// only) for headings. next/font serves both from /docs/_next/, like every asset
// of this app; global.css hands them to Tailwind and Fumadocs.
const arimo = Arimo({
  variable: "--font-arimo",
  subsets: ["latin"],
});

const apkFutural = localFont({
  src: "./fonts/APK-Futural-Regular.woff2",
  weight: "400",
  variable: "--font-apk-futural",
});

// Unset reports every page load; next.config.mjs rejects a value outside 0–1.
// Web Analytics has no sampling and counts every page view.
const speedInsightsSampleRate = Number(process.env.DOCS_SPEED_INSIGHTS_SAMPLE_RATE || 1);

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${arimo.variable} ${apkFutural.variable}`} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          // The search route lives under /docs, like every other route.
          search={{ options: { api: "/docs/api/search" } }}
          // Fumadocs styles the dark theme by the class; the design tokens
          // switch on data-theme, as in the console. Set both.
          theme={{ attribute: ["class", "data-theme"] }}
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
