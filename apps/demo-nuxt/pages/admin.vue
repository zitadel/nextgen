<template>
  <main style="padding: 48px; max-width: 600px; margin: 0 auto">
    <h1 style="font-size: 24px; font-weight: 700">Admin</h1>
    <p style="color: #6b7280">
      Signed in as {{ auth?.isAuthenticated ? auth.session.email : "unknown" }}
    </p>
  </main>
</template>

<script setup lang="ts">
const auth = useState("nextgen-auth");
</script>
