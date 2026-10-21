"use client";

import dynamic from "next/dynamic";

const ZitadelLogout = dynamic(
  async () => {
    const { ZitadelLogout: Logout, configureZitadel } = await import(
      "@zitadel/sdk-next/components"
    );
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "proj_demo",
      proxyPath: "/__nextgen",
    });
    return function ZitadelLogoutElement() {
      // The admin page's surface is fixed light, so declare it — same
      // contract as the login page's widget.
      return <Logout project={project} theme="light" postSignOutUrl="/login" />;
    };
  },
  { ssr: false },
);

export function LogoutWidget() {
  return <ZitadelLogout />;
}
