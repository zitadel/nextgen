import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Arimo } from "next/font/google";
import localFont from "next/font/local";
import icon from "./zitadel-icon.svg";
import "./globals.css";

// The website's faces: Arimo for text, APK Futural (a licensed webfont) for
// headings. next/font serves both from /_next/, like every asset of this app.
const arimo = Arimo({
  variable: "--font-arimo",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const apkFutural = localFont({
  src: "./fonts/APK-Futural-Regular.woff2",
  weight: "400",
  variable: "--font-apk-futural",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Zitadel — Coming soon",
  description: "The next generation of Zitadel is coming soon.",
  // An import rather than app/icon.svg, which Next would serve at the root,
  // a path the cloud routes to the server.
  icons: { icon: { url: icon.src, type: "image/svg+xml" } },
};

// Unset reports every page load; next.config.ts rejects a value outside 0–1.
// Web Analytics has no sampling and counts every page view.
const speedInsightsSampleRate = Number(process.env.WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE || 1);

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${arimo.variable} ${apkFutural.variable}`}>
      <body className="bg-background text-foreground antialiased">
        {children}
        <Analytics />
        {/* The package reads a rate of 0 as unset, which would send every
            page load. */}
        {speedInsightsSampleRate > 0 && <SpeedInsights sampleRate={speedInsightsSampleRate} />}
      </body>
    </html>
  );
}
