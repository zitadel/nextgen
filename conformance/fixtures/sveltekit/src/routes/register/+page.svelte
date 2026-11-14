<script lang="ts">
  // zitadel-cli: managed-file v1
  import { onMount } from "svelte";
  import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-svelte";

  const project = configureZitadel({
    projectId: import.meta.env.VITE_ZITADEL_PROJECT_ID ?? "",
    proxyPath: "/__nextgen",
  });
  // Mount the widget on the client only. onMount never runs during SSR, and
  // unlike $app/environment (deprecated in SvelteKit 3) it works on 2 and 3.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
</script>

<main style="position:fixed;inset:0;overflow:auto;background:#0f0f11;color-scheme:dark">
  {#if mounted}
    <ZitadelLogin {project} purpose="register" postSignInUrl="/profile" />
  {/if}
</main>
