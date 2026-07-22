import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Page } from "./layout";
import { EmptyState, PageHeader } from "./resource-page";

/**
 * Full page for a sidebar destination whose backing API endpoint does not
 * exist yet. Renders the page hero plus an honest "coming soon" empty state
 * instead of a fabricated list (see the console-figma-api-buildability
 * assessment for the endpoint gaps).
 */
export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Page>
      <PageHeader title={title} />
      <EmptyState title="Coming soon" description={description} icon={icon} />
    </Page>
  );
}
