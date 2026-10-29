import { ZitadelLogin } from "@zitadel/sdk-react";

import { NoProjectYet, StandaloneScreen } from "@/components/standalone-screen";
import { InlineCode } from "@/components/ui/inline-code";
import { useConsoleProject } from "@/hooks/use-console-project";
import { withBasePath } from "@/lib/base-path";
import { useTheme } from "@/theme";

/**
 * The screen `/login` and `/signup` share (Console ADR 0003): the embedded
 * `<zitadel-login>` widget, opened on the flow purpose the route names.
 *
 * The widget gets a per-element `project` **handle** built from the
 * runtime-discovered project id (Console ADR 0004 §3), not discrete
 * `projectId`/`proxyPath` props: its config precedence is element `project`
 * property → global `configureZitadel()` → declarative attributes
 * (`resolve-api.ts`), and the console's app-wide `configureZitadel()` call
 * carries an empty project id, so attribute-level config would lose to it and
 * the widget would refuse to start a flow. On a terminal step the widget
 * exchanges its `handoff_token` for the `__nextgen_session` HttpOnly cookie
 * before navigating to `postSignInUrl`, a full-document navigation, so the app
 * reboots with the cookie in place.
 *
 * `next` is the sanitized router-relative path to land on, re-joined with the
 * Vite `BASE_URL` so the navigation lands inside the deployed prefix
 * (`/ui/console` in production, `/` in dev). The widget would otherwise return
 * to the page's `next` itself, which lacks the prefix, so `forcePostSignInUrl`
 * keeps it on `postSignInUrl`.
 *
 * The widget resolves its own colour mode (element `theme` → tenant branding
 * → dark) and paints no surface of its own; this screen fixes its background,
 * so it hands the widget the console's resolved theme.
 */
export function SignInScreen({
  purpose,
  heading,
  next,
}: {
  purpose: "login" | "register";
  heading: string;
  next?: string;
}) {
  const { resolved: theme } = useTheme();
  const postSignInUrl = withBasePath(next ?? "/") || "/";

  // With the runtime-discovered publishable key the widget sends the
  // public-plane bearer itself, so the handoff exchange needs no server-side
  // secret injection.
  const project = useConsoleProject();

  return (
    <StandaloneScreen heading={heading}>
      {project ? (
        <ZitadelLogin
          project={project}
          purpose={purpose}
          theme={theme}
          postSignInUrl={postSignInUrl}
          forcePostSignInUrl
        />
      ) : (
        <NoProjectSetupHint />
      )}
    </StandaloneScreen>
  );
}

/**
 * Rendered while the deployment has no project. Under Console ADR 0004 §2's
 * transitional cutover rule, the server still discovers the first-created or
 * explicitly pinned project until a human-usable seed transport replaces that
 * fallback. Refreshing after `zitadel setup` picks the new project up via the
 * runtime document.
 */
function NoProjectSetupHint() {
  return (
    <NoProjectYet>
      This deployment has no project to sign in to. Create one from your application with{" "}
      <InlineCode>npx @zitadel/cli setup</InlineCode> — the first project becomes the console&apos;s
      default. Then refresh this page.
    </NoProjectYet>
  );
}
