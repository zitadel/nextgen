"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ZitadelLogin = dynamic(
  async () => {
    await import("@zitadel-nextgen/components");
    return function ZitadelLoginElement() {
      return <zitadel-login api-base="/__nextgen" project-id="demo" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  const router = useRouter();

  useEffect(() => {
    // TODO: move into <zitadel-login> web component (follow-up PR)
    // Note: router.push() is correct here — Next.js middleware runs on every
    // navigation (including client-side), so the server will re-evaluate the
    // new __nextgen_session cookie without needing a full hard reload.
    async function handleFlowComplete(event: Event) {
      const { handoff_token } = (event as CustomEvent<{ handoff_token: string }>).detail;
      const resp = await fetch("/__nextgen/sessions/exchange", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoff_token }),
      });
      if (!resp.ok) {
        console.error("[nextgen] sessions/exchange failed:", resp.status, await resp.text());
        return;
      }
      router.push("/admin");
    }

    document.addEventListener("zitadel-flow-complete", handleFlowComplete);
    return () => document.removeEventListener("zitadel-flow-complete", handleFlowComplete);
  }, [router]);

  return <ZitadelLogin />;
}
