import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";
import "./global.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: {
    template: "%s | ZITADEL Docs",
    default: "ZITADEL NextGen Documentation",
  },
  description:
    "API reference, guides, and tutorials for the ZITADEL NextGen identity platform.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
