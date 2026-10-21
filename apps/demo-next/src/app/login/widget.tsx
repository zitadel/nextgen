"use client";

import dynamic from "next/dynamic";

const ZitadelLogin = dynamic(
  async () => {
    // The SDK's components entry registers the widget elements and builds the
    // project handle, so the app depends on `@zitadel/sdk-next` alone.
    const { ZitadelLogin: Login, configureZitadel } = await import("@zitadel/sdk-next/components");
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "proj_demo",
      proxyPath: "/__nextgen",
    });
    return function ZitadelLoginElement() {
      // This page fixes its surface to light (see page.tsx), so declare it on
      // the widget: the element-level `theme` outranks tenant branding (the
      // dev mock pins dark), which is the documented contract for embedding
      // into a page whose colour is not negotiable.
      return <Login project={project} theme="light" postSignInUrl="/admin" />;
    };
  },
  { ssr: false },
);

export function LoginWidget() {
  return <ZitadelLogin />;
}
