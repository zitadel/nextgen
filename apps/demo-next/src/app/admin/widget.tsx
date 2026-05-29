"use client";

import dynamic from "next/dynamic";

const ZitadelLogout = dynamic(
  async () => {
    const { demoProject } = await import("@/zitadel");
    await import("@zitadel-nextgen/components");
    return function ZitadelLogoutElement() {
      return <zitadel-logout project={demoProject} post-sign-out-url="/login" />;
    };
  },
  { ssr: false },
);

export function LogoutWidget() {
  return <ZitadelLogout />;
}
