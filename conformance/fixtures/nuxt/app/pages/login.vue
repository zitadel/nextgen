<script setup lang="ts">
// zitadel-cli: managed-file v1
const project = useZitadelProject();
</script>

<template>
  <main style="color-scheme: dark">
    <ClientOnly>
      <!-- variant="page" paints the widget's full-page chrome from design
           tokens; variant="widget" embeds the card inside a layout you own. -->
      <zitadel-login
        variant="page"
        :project="project"
        post-sign-in-url="/profile"
      />
    </ClientOnly>
  </main>
</template>
