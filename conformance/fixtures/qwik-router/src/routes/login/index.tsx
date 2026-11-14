// zitadel-cli: managed-file v1
import { component$ } from "@qwik.dev/core";
import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-qwik";

const project = configureZitadel({
  projectId: import.meta.env.PUBLIC_ZITADEL_PROJECT_ID ?? "",
  proxyPath: "/__nextgen",
});

export default component$(() => {
  return (
    <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
      <ZitadelLogin project={project} purpose="login" postSignInUrl="/profile" />
    </div>
  );
});
