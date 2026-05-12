"use client";

import dynamic from "next/dynamic";

const NextgenLogout = dynamic(
  async () => {
    await import("@nextgen/ui-lit");
    return function NextgenLogoutElement() {
      return <nextgen-logout proxy-base="/__nextgen" post-sign-out-url="/login" />;
    };
  },
  { ssr: false },
);

export function LogoutWidget() {
  return <NextgenLogout />;
}
