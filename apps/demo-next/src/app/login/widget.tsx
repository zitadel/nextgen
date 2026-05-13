"use client";

import dynamic from "next/dynamic";

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
  return <ZitadelLogin />;
}
