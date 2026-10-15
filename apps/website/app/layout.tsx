import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import localFont from "next/font/local";
import og from "./og.jpg";
import "./globals.css";

// The website's faces: Arimo for text, APK Futural (a licensed webfont) for
// headings, Azeret Mono for code, all from ./fonts so the build fetches
// nothing (AGENTS.md). next/font serves them from /_next/, like every asset of
// this app.
//
// Arimo is one variable file, every weight from 400 to 700, declared as such:
// the page sets text at 400 and 600, the brand playground's card titles at
// 500.
const arimo = localFont({
  src: "./fonts/Arimo-latin.woff2",
  weight: "400 700",
  variable: "--font-arimo",
  display: "swap",
});

const azeretMono = localFont({
  src: "./fonts/AzeretMono-Medium-latin.woff2",
  weight: "500",
  variable: "--font-azeret-mono",
  display: "swap",
});

const apkFutural = localFont({
  src: "./fonts/APK-Futural-Regular.woff2",
  weight: "400",
  variable: "--font-apk-futural",
  display: "swap",
});

const title = "Zitadel preview — a login experience you control, in one minute";
const description =
  "The open-source identity platform for users, services, and AI agents, built for developers and the agents they work with. Your user model, your login flow, and your styling are files in your repo.";

// The share image is the website's own (zitadel/new-website's
// public/cms/og-zitadel-homepage.jpg), imported so it loads from /_next/
// (AGENTS.md); on Vercel, Next makes its URL absolute with the deployment's
// host.
export const metadata: Metadata = {
  title,
  description,
  icons: favicons(),
  openGraph: {
    type: "website",
    siteName: "Zitadel",
    title,
    description,
    images: [{ url: og.src, width: og.width, height: og.height, alt: "Zitadel" }],
  },
  twitter: { card: "summary_large_image", title, description, images: [og.src] },
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
