import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth, ZitadelProvider } from "@zitadel/sdk-next/server";

import { DEMO_PROJECT_ID } from "../project";

export const metadata: Metadata = {
  title: "Zitadel Auth Demo",
  description: "Embedded authentication powered by Zitadel",
};

/**
 * Seeds client components (`useAuth()`) with the server-known auth state.
 * ZitadelProvider strips the raw session token before the value crosses into
 * client code, so only userId / identifier / display reach the browser. Note that
 * `auth()` only sees a session on routes the middleware matcher covers
 * (/admin, /login here) — on other routes the provider seeds signed-out.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await auth({ projectId: DEMO_PROJECT_ID });
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif", background: "#f3f4f6" }}>
        <ZitadelProvider session={session}>{children}</ZitadelProvider>
      </body>
    </html>
  );
}
