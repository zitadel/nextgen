import type { LucideIcon } from "lucide-react";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

import { RESOURCE_TABLE_WRAP } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * What a directory shows in place of its table when it lists nothing: the
 * resource's icon, a title, one sentence on how to make the first one, and,
 * when the design draws one, a link to the guide. It sits in the table's own
 * card, so the screen keeps its frame.
 */
export function ResourceEmpty({
  icon: Icon,
  title,
  children,
  docsHref,
}: {
  icon: LucideIcon;
  title: string;
  /** The one sentence, often with a `CliCommand` in it. */
  children: ReactNode;
  docsHref?: string;
}) {
  return (
    <div className={`${RESOURCE_TABLE_WRAP} p-6`}>
      <Empty className="gap-4 p-6 md:p-12">
        <EmptyHeader className="max-w-none gap-4">
          <EmptyMedia variant="icon" className="mb-0">
            <Icon aria-hidden strokeWidth={1.5} className="size-6" />
          </EmptyMedia>
          <EmptyTitle asChild className="text-base leading-5">
            <h2>{title}</h2>
          </EmptyTitle>
          <EmptyDescription className="text-sm leading-6">{children}</EmptyDescription>
          {docsHref && (
            <Button variant="ghost" size="sm" className="gap-1 text-xs" asChild>
              <a href={docsHref} target="_blank" rel="noreferrer">
                Read documentation
                <ExternalLink aria-hidden strokeWidth={1.5} className="size-3.5" />
              </a>
            </Button>
          )}
        </EmptyHeader>
      </Empty>
    </div>
  );
}
