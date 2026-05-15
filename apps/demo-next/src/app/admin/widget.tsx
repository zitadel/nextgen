"use client";

import dynamic from "next/dynamic";

const ZitadelLogout = dynamic(
  async () => {
    await import("@zitadel-nextgen/components");
    return function ZitadelLogoutElement() {
      return <zitadel-logout proxy-base="/__nextgen" post-sign-out-url="/login" />;
    };
  },
  { ssr: false },
);

export function LogoutWidget() {
  return <ZitadelLogout />;
}
