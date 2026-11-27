import type { ReactNode } from "react";

import { PAGE_TITLE, PAGE_TITLE_ROW } from "./typography";

/**
 * Page hero: title + optional sub-headline on the left, optional trailing
 * action on the right. For filter tabs use shadcn `Tabs` (see Users).
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className={PAGE_TITLE_ROW}>
        <h1 className={PAGE_TITLE}>{title}</h1>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
