import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

// The classes of the Spacious layout's own sidebar items (`itemVariants` in
// fumadocs-ui's layouts/spacious/slots/sidebar), so these sit among them, and
// their colour when active.
export const SIDEBAR_ITEM =
  "relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-fd-ring [&_svg]:size-4 [&_svg]:shrink-0";
export const SIDEBAR_ITEM_ACTIVE = "bg-fd-primary/10 text-fd-primary";

// The site bar over the layout (components/site-header.tsx) holds the logo,
// the website's pages, GitHub and the theme, so Fumadocs shows none of them.
export function baseOptions(): BaseLayoutProps {
  return {
    themeSwitch: { enabled: false },
  };
}
