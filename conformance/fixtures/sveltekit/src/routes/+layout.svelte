<script lang="ts">
  // zitadel-cli: managed-file v1
  let { children } = $props();
</script>

{@render children()}

<style>
  :global(:root) {
    color-scheme: dark;
  }
  :global(body) {
    margin: 0;
    background: #0f0f11;
    color: #f4f4f6;
    font-family: sans-serif;
  }
</style>
