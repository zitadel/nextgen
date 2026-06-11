import { MANAGED_MARKER } from "../../../../paths";

export { PROXY_ENTRY_CODE, PROXY_IMPORT, PROXY_PATH } from "../vite-proxy";
import { PROXY_PATH } from "../vite-proxy";

/**
 * The managed `src/App.tsx`: a minimal path-based router that renders the
 * `@zitadel/sdk-react` widgets — login at `/login` (and `/`), register at
 * `/register`, and the logout widget at `/profile`. The project id comes from
 * `VITE_ZITADEL_PROJECT_ID` (Vite only exposes `VITE_`-prefixed env to the
 * client); the secret never reaches the browser — it is injected by the dev
 * proxy in `vite.config.ts`.
 */
export function appTemplate(): string {
  return `${MANAGED_MARKER}
import { ZitadelLogin, ZitadelLogout, configureZitadel } from "@zitadel/sdk-react";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "${PROXY_PATH}",
});

export default function App() {
  const path = window.location.pathname;

  if (path.startsWith("/profile")) {
    return <ZitadelLogout project={project} postSignOutUrl="/login" />;
  }
  if (path.startsWith("/register")) {
    return <ZitadelLogin project={project} purpose="register" postSignInUrl="/profile" />;
  }
  return <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />;
}
`;
}
