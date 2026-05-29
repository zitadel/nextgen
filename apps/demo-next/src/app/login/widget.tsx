"use client";

import dynamic from "next/dynamic";

const ZitadelLogin = dynamic(
  async () => {
    const { demoProject } = await import("@/zitadel");
    await import("@zitadel-nextgen/components");
    return function ZitadelLoginElement() {
      return <zitadel-login project={demoProject} post-sign-in-url="/admin" locales={{ en: { "identifier.title": "Howdy!" } }}
      />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <ZitadelLogin />;
}
