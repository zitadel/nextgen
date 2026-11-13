<script lang="ts">
// zitadel-cli: managed-file v1
import { onMount } from "svelte";
import { ZitadelLogin, ZitadelSession, configureZitadel } from "@zitadel/sdk-svelte";

const project = configureZitadel({
  projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID,
  proxyPath: "/__nextgen",
});

const path = window.location.pathname;

onMount(() => {
  if (path === "/") {
    window.location.replace("/login");
  }
});
</script>

{#if path.startsWith("/profile")}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelSession {project} postSignOutUrl="/login" />
  </div>
{:else if path.startsWith("/register")}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin {project} purpose="register" postSignInUrl="/profile" />
  </div>
{:else if path !== "/"}
  <div style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
    <ZitadelLogin {project} purpose="login" postSignInUrl="/profile" />
  </div>
{/if}
