import DocsLayout from "./docs/layout";
import NotFound from "./docs/not-found";

// Unknown docs slugs and unmatched routes share this prerendered 404, in the
// docs' chrome. Its inline scripts are fixed at build time, so csp-adapter.mjs
// can hash them into the policy every unknown URL carries.
export default function RootNotFound() {
  return (
    <DocsLayout>
      <NotFound />
    </DocsLayout>
  );
}
