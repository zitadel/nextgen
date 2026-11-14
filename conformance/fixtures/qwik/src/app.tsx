// zitadel-cli: managed-file v1
import { component$, useVisibleTask$ } from "@qwik.dev/core";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "/__nextgen",
});

export const App = component$(() => {
  const path = window.location.pathname;

  useVisibleTask$(() => {
    if (path === "/") {
      window.location.replace("/login");
    }
  });

  if (path === "/") {
    return null;
  }
  if (path.startsWith("/profile")) {
    return (
      <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelSession project={project} postSignOutUrl="/login" />
      </div>
    );
  }
  if (path.startsWith("/register")) {
    return (
      <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
        <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />
      </div>
    );
  }
  return (
    <div style={{ position: "fixed", inset: "0", overflow: "auto", background: "#0f0f11", colorScheme: "dark" }}>
      <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />
    </div>
  );
});
