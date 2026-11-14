// zitadel-cli: managed-file v1
"use client";

import dynamic from "next/dynamic";

const ZitadelSession = dynamic(
  async () => {
    const { ZitadelSession: Session, configureZitadel } = await import(
      "@zitadel/sdk-next/components"
    );
    // Build the SDK project handle and pass it to the session card via the
    // `project` prop. The card reads identity from "/__nextgen/api/v1/sessions/me"
    // and exposes a Sign out action. Your own components (a header, an
    // account menu) can make the same read with getSession() from
    // "@zitadel/sdk-next/session" to swap sign-in CTAs for account chrome.
    const project = configureZitadel({
      projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "",
      proxyPath: "/__nextgen",
    });
    return function ZitadelSessionElement() {
      return (
        <Session
          variant="page"
          project={project}
          postSignOutUrl="/login"
        />
      );
    };
  },
  { ssr: false },
);

export default function ProfilePage() {
  // variant="page" makes the session card paint the full-page chrome itself
  // (viewport height, surface background) from design tokens; switch to
  // variant="widget" to embed the card inside a layout you own.
  // The wrapper paints the widget's dark page surface before the client-only
  // widget mounts, so the page does not flash the app's own background first.
  // Change both when you pin another theme on the widget.
  return (
    <main style={{ minHeight: "100vh", background: "#050505", colorScheme: "dark" }}>
      <ZitadelSession />
    </main>
  );
}
