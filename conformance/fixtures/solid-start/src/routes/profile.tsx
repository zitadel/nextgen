// zitadel-cli: managed-file v1
import { clientOnly } from "@solidjs/start";

const ZitadelSession = clientOnly(() =>
  import("@zitadel/sdk-solid-start/components").then((m) => ({ default: m.ZitadelSession })),
);

export default function Profile() {
  return (
    <main style="position:fixed;inset:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:48px;box-sizing:border-box;background:#0f0f11;color-scheme:dark">
      <ZitadelSession
        projectId={import.meta.env.VITE_ZITADEL_PROJECT_ID ?? ""}
        proxyPath="/__nextgen"
        postSignOutUrl="/login"
      />
    </main>
  );
}
