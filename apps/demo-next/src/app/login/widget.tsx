"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const ZitadelLogin = dynamic(
  async () => {
    await import("@zitadel-nextgen/components");
    return function ZitadelLoginElement() {
      return <zitadel-login proxy-base="/__nextgen" post-sign-in-url="/admin" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  const router = useRouter();

  useEffect(() => {
    // TODO: move into <zitadel-login> web component (follow-up PR)
    async function handleFlowComplete(event: Event) {
      const { handoff_token } = (event as CustomEvent<{ handoff_token: string }>).detail;
      await fetch("/__nextgen/sessions/exchange", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoff_token }),
      });
      router.push("/admin");
    }

    document.addEventListener("zitadel-flow-complete", handleFlowComplete);
    return () => document.removeEventListener("zitadel-flow-complete", handleFlowComplete);
  }, [router]);

  return <ZitadelLogin />;
}
