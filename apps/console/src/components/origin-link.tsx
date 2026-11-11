import { Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
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
