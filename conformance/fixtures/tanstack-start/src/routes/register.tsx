// zitadel-cli: managed-file v1
import { createFileRoute } from "@tanstack/react-router";
import { ZitadelLogin } from "@zitadel/sdk-tanstack-start/react";
import { configureZitadel } from "@zitadel/sdk-tanstack-start/client";

const projectId = import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "";

const project = configureZitadel({ projectId, proxyPath: "/__nextgen" });

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

function RegisterPage() {
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />
    </div>
  );
}
