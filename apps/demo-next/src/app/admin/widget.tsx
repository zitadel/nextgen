"use client";

import dynamic from "next/dynamic";

const ZitadelLogout = dynamic(
  async () => {
    const { demoProject } = await import("@/zitadel");
    await import("@zitadel/components");
    return function ZitadelLogoutElement() {
      // The admin page's surface is fixed light, so declare it — same
      // contract as the login page's widget.
      return <zitadel-logout project={demoProject} theme="light" post-sign-out-url="/login" />;
    };
  },
  { ssr: false },
);

export function LogoutWidget() {
  return <ZitadelLogout />;
}
