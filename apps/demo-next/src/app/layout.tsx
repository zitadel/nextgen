import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Nextgen Auth Demo",
  description: "Embedded authentication powered by Nextgen",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f3f4f6" }}>{children}</body>
    </html>
  );
}
