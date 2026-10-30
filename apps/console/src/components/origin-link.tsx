import { Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DeploymentTarget } from "@/lib/deployment";
import { cn } from "@/lib/utils";

/**
 * An origin as a link that opens what it serves, in a new tab. The text
 * truncates to its container. `px-0!`: the size's `has-[>svg]:px-1.5` is a
 * variant and out-specifies a plain `px-0`.
 */
export function OriginLink({
  origin,
  className,
  iconClassName,
}: {
  origin: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Button asChild variant="link" size="xs" className={cn("h-6 max-w-full px-0!", className)}>
      <a href={origin} target="_blank" rel="noreferrer">
        <LinkIcon aria-hidden className={iconClassName} />
        <span className="truncate">{origin}</span>
      </a>
    </Button>
  );
}

/**
 * A deployment's target: its origin as a link, or the default target, which has
 * no address to open.
 */
export function TargetLink({
  target,
  className,
  iconClassName,
}: {
  target: DeploymentTarget;
  className?: string;
  iconClassName?: string;
}) {
  if (target.type === "default") {
    return <span className={cn("text-xs", className)}>Default target</span>;
  }
  return <OriginLink origin={target.origin} className={className} iconClassName={iconClassName} />;
}
