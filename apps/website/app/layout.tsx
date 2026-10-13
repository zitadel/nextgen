import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { Arimo, Azeret_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// The website's faces: Arimo for text, APK Futural (a licensed webfont) for
// headings, Azeret Mono for code. next/font serves them from /_next/, like
// every asset of this app.
const arimo = Arimo({
  variable: "--font-arimo",
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
});

const azeretMono = Azeret_Mono({
  variable: "--font-azeret-mono",
  subsets: ["latin"],
  weight: "500",
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
// zitadel/new-website), served from public/favicons/ and declared as it does:
// a dark mark for a light browser, a light one for a dark browser. The
// console, the login UI and the docs link this same set (AGENTS.md).
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

// Unset reports every page load; next.config.ts rejects a value outside 0–1.
// Web Analytics has no sampling and counts every page view.
const speedInsightsSampleRate = Number(process.env.WEBSITE_SPEED_INSIGHTS_SAMPLE_RATE || 1);

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${arimo.variable} ${apkFutural.variable} ${azeretMono.variable}`}>
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
