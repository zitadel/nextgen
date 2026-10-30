import DocsLayout from "./docs/layout";
import NotFound from "./docs/not-found";

// Unknown docs slugs and unmatched routes share this prerendered 404. Keep
// the docs' chrome while serving complete HTML under the scriptless CSP.
export default function RootNotFound() {
  return (
    <DocsLayout>
      <NotFound />
    </DocsLayout>
  );
}
