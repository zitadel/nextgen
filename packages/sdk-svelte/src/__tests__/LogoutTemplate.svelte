<!-- Fixture for index.spec.ts: the README's template-mode example, compiled by Svelte. -->
<script lang="ts">
  import type { ZitadelProject } from '@zitadel/api/config';

  import ZitadelLogout from '../lib/ZitadelLogout.svelte';

  let { project }: { project: ZitadelProject } = $props();
</script>

<ZitadelLogout {project}>
  <template><button data-action="logout">Sign out {'{{display}}'}</button></template>
</ZitadelLogout>
