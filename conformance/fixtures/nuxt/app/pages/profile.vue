<script setup lang="ts">
// zitadel-cli: managed-file v1
const project = useZitadelProject();
</script>

<template>
  <main style="color-scheme: dark">
    <ClientOnly>
      <!-- variant="page" paints the session card's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own.
           Your own components (a header, an account menu) read the same session
           state with the auto-imported useAuth() composable. -->
      <zitadel-session variant="page" :project="project" post-sign-out-url="/login" />
    </ClientOnly>
  </main>
</template>
