// zitadel-cli: managed-file v1
import { clientOnly } from "@solidjs/start";

const ZitadelLogin = clientOnly(() =>
  import("@zitadel/sdk-solid-start/components").then((m) => ({ default: m.ZitadelLogin })),
);

export default function Login() {
  return (
    <main style="position:fixed;inset:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:48px;box-sizing:border-box;background:#0f0f11;color-scheme:dark">
      <ZitadelLogin
        projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID ?? ""}
        proxyPath="/__nextgen"
        purpose="login"
        postSignInUrl="/profile"
      />
    </main>
  );
}
