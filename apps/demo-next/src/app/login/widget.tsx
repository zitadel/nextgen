"use client";

import dynamic from "next/dynamic";

const ZitadelLogin = dynamic(
  async () => {
    const { demoProject } = await import("@/zitadel");
    await import("@zitadel/components");
    return function ZitadelLoginElement() {
      // This page fixes its surface to light (see page.tsx), so declare it on
      // the widget: the element-level `theme` outranks tenant branding (the
      // dev mock pins dark), which is the documented contract for embedding
      // into a page whose colour is not negotiable.
      return <zitadel-login project={demoProject} theme="light" post-sign-in-url="/admin" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <ZitadelLogin />;
}
