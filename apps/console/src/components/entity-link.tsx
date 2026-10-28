import { createLink } from "@tanstack/react-router";
import type { AnchorHTMLAttributes, Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * A referenced configuration in a table cell: muted text that turns
 * `foreground` on hover and on keyboard focus. No icon, no underline, no
 * background, so it never competes with the row's own name.
 */
const ENTITY_LINK =
  "text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/50 cursor-pointer rounded-sm no-underline transition-colors outline-none focus-visible:ring-[3px]";

function EntityAnchor({
  className,
  ref,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} className={cn(ENTITY_LINK, className)} {...props} />;
}

/**
 * A router link to a referenced configuration (a user schema, a login flow)
 * from a table row that is not that configuration.
 *
 * It is a real `<a>` with the route's href, so cmd/ctrl-click and middle-click
 * open a new tab. A row's `onOpen` ignores clicks that land on a link
 * (`opensRow`), so following the reference never opens the row as well.
 */
export const EntityLink = createLink(EntityAnchor);
