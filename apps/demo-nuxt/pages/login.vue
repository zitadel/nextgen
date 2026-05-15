<template>
  <main
    style="
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: #f3f4f6;
    "
  >
    <ClientOnly>
      <zitadel-login api-base="/__nextgen" project-id="demo" />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import "@zitadel-nextgen/components";
import type { ClientAuthResult } from "@nextgen/sdk-nuxt";

const auth = useState<ClientAuthResult>("nextgen-auth");
if (auth.value?.isAuthenticated) {
  await navigateTo("/admin");
}

// TODO: move into <zitadel-login> web component (follow-up PR)
onMounted(() => {
  async function handleFlowComplete(event: Event) {
    const { handoff_token } = (event as CustomEvent<{ handoff_token: string }>).detail;
    const resp = await fetch("/__nextgen/sessions/exchange", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoff_token }),
    });
    if (!resp.ok) {
      console.error("[nextgen] sessions/exchange failed:", resp.status, await resp.text());
      return;
    }
    // Hard navigation forces a full server round-trip so Nuxt's server
    // middleware re-runs with the new __nextgen_session cookie. A client-side
    // navigateTo() would skip the server and leave useState("nextgen-auth")
    // stale from the login-page SSR.
    window.location.href = "/admin";
  }

  document.addEventListener("zitadel-flow-complete", handleFlowComplete);
  onUnmounted(() => document.removeEventListener("zitadel-flow-complete", handleFlowComplete));
});
</script>
