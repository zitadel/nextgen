import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { House } from "lucide-react";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

import { docsRoute, gitConfig } from "./shared";

// The classes of the Spacious layout's own sidebar items (`itemVariants` in
// fumadocs-ui's layouts/spacious/slots/sidebar), so these sit among them.
const SIDEBAR_ITEM =
  "relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-start text-fd-muted-foreground outline-none transition-colors hover:text-fd-accent-foreground focus-visible:ring-2 focus-visible:ring-fd-ring [&_svg]:size-4 [&_svg]:shrink-0";

// A link to another app of the cloud's host. Fumadocs renders a link item
// through next/link, which would prefetch the page from this app and route
// to it here, or, marked external, in a new tab; a custom item is a plain
// <a> (AGENTS.md).
function hostLink(href: string, icon: ReactNode, text: string) {
  return {
    type: "custom" as const,
    children: (
      <a href={href} className={SIDEBAR_ITEM}>
        {icon}
        {text}
      </a>
    ),
  };
}

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // The website's header, read out as "Zitadel Docs": its animated logo
      // at its size, and in place of its Preview label the same pill saying
      // where you are.
      title: (
        <>
          <Logo id="docs-logo" className="h-6 w-auto" />
          <span className="rounded-full border border-fd-border px-2.5 py-0.5 font-semibold text-fd-muted-foreground text-xs leading-4">
            Docs
          </span>
        </>
      ),
      // The docs' home; on the cloud's host / is the website's start page.
      url: docsRoute,
    },
    // The website, above the pages.
    links: [hostLink("/", <House />, "Preview home")],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
