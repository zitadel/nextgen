import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth, NextgenProvider } from "@zitadel/sdk-next/server";

export const metadata: Metadata = {
  title: "Nextgen Auth Demo",
  description: "Embedded authentication powered by Nextgen",
};

/**
 * Seeds client components (`useAuth()`) with the server-known auth state.
 * NextgenProvider strips the raw session token before the value crosses into
 * client code, so only userId / email / name reach the browser. Note that
 * `auth()` only sees a session on routes the middleware matcher covers
 * (/admin, /login here) — on other routes the provider seeds signed-out.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f3f4f6" }}>
        <NextgenProvider session={session}>{children}</NextgenProvider>
      </body>
    </html>
  );
}
