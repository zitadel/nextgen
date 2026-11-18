// zitadel-cli: managed-file v1
"use client";

import dynamic from "next/dynamic";

const ZitadelLogin = dynamic(
  async () => {
    const { ZitadelLogin: Login, configureZitadel } = await import("@zitadel/sdk-next/components");
    // Build the SDK project handle and pass it to the component via the
    // `project` prop. The component reads config from this prop directly, so
    // it works regardless of how the SDK packages are bundled. The backend URL
    // stays server-side: requests go through the proxy path "/__nextgen",
    // which the scaffolded request boundary forwards to the Zitadel server.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ZitadelLoginElement() {
      return (
        <Login
          variant="page"
          project={project}
          purpose="login"
          postSignInUrl="/profile"
        />
      );
    };
  },
  { ssr: false },
);

export default function LoginPage() {
  // variant="page" makes the widget paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; switch to
  // variant="widget" to embed the sign-in card inside a layout you own.
  // The wrapper paints the widget's dark page surface before the client-only
  // widget mounts, so the page does not flash the app's own background first.
  // Change both when you pin another theme on the widget.
  return (
    <main style={{ minHeight: "100vh", background: "#050505", colorScheme: "dark" }}>
      <ZitadelLogin />
    </main>
  );
}
