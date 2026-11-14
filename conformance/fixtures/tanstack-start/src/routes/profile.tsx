// zitadel-cli: managed-file v1
import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ZitadelSession } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";
import { getAuth } from "@zitadel/sdk-tanstack-start/server";

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "/__nextgen" });

// Runs on the server on every navigation, client-side ones included. Its
// return value is sent to the browser, so it returns only client-safe fields:
// getAuth's session carries the raw session credential, which must stay on the server.
const fetchAuth = createServerFn().handler(({ context }) => {
  const { isAuthenticated, session } = getAuth(context);
  return { isAuthenticated, userId: session?.userId ?? null };
});

export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    const auth = await fetchAuth();
    if (!auth.isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: ProfilePage,
});

function ProfilePage() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelSession project={project} postSignOutUrl="/login" />
    </div>
  );
}
