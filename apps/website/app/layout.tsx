import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Arimo } from "next/font/google";
import localFont from "next/font/local";
import dark from "./icons/dark.ico";
import dark16 from "./icons/dark-16.png";
import dark32 from "./icons/dark-32.png";
import dark180 from "./icons/dark-180.png";
import light from "./icons/light.ico";
import light16 from "./icons/light-16.png";
import light32 from "./icons/light-32.png";
import light180 from "./icons/light-180.png";
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
  icons: favicons(),
};

// The website's favicons (packages/theme/assets/favicons in
// zitadel/new-website), declared as it does: a dark mark for a light browser,
// a light one for a dark browser. Imports rather than app/icon.png and the
// like, which Next would serve at the root, a path the cloud routes to the
// server.
function favicons(): Metadata["icons"] {
  const schemes = [
    {
      media: "(prefers-color-scheme: light)",
      ico: light,
      px16: light16,
      px32: light32,
      px180: light180,
    },
    {
      media: "(prefers-color-scheme: dark)",
      ico: dark,
      px16: dark16,
      px32: dark32,
      px180: dark180,
    },
  ];
  return {
    icon: schemes.flatMap(({ media, ico, px16, px32 }) => [
      { url: px16.src, sizes: "16x16", type: "image/png", media },
      { url: px32.src, sizes: "32x32", type: "image/png", media },
      { url: ico.src, type: "image/x-icon", media },
    ]),
    shortcut: schemes.map(({ media, ico }) => ({ url: ico.src, type: "image/x-icon", media })),
    apple: schemes.map(({ media, px180 }) => ({
      url: px180.src,
      sizes: "180x180",
      type: "image/png",
      media,
    })),
  };
}

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
