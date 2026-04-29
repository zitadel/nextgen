<template>
  <main class="center">
    <ClientOnly>
      <nextgen-login proxy-base="/__nextgen" @nextgen-signin="onSignIn" />
    </ClientOnly>
  </main>
</template>

<script setup lang="ts">
import "@nextgen/ui-lit";

function onSignIn(e: Event) {
  console.log("signed in", (e as CustomEvent).detail);
  navigateTo("/dashboard");
}
</script>

<style scoped>
.center {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f3f4f6;
}
</style>
