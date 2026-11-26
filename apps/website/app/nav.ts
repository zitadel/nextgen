import { links } from "./links";
import { PHASES, phasePath } from "./phases";

// The header's top level after the logo, left to right (site-header.tsx):
// each item a link, or a menu whose panel sets its groups side by side and
// whose groups a phone's menu lists one under another, each under its
// heading. A Solutions menu or a Pricing link is one more item here, and a
// Features group one more group in Product: data, not layout.

/** A page in a menu's group; `id` is the page's, which marks it as the current one. */
export type NavEntry = { label: string; href: string; line?: string; id?: string };

/** A menu's group of pages under its heading, counted when `numbered`. */
export type NavGroup = { heading: string; numbered?: boolean; entries: readonly NavEntry[] };

export type NavItem =
  | { kind: "link"; label: string; href: string; id?: string }
  | { kind: "menu"; label: string; groups: readonly NavGroup[] };

export const NAV: readonly NavItem[] = [
  {
    kind: "menu",
    label: "Product",
    groups: [
      {
        heading: "How it works",
        numbered: true,
        entries: PHASES.map(({ slug, short, title }) => ({
          label: short,
          href: phasePath(slug),
          line: title,
          id: slug,
        })),
      },
    ],
  },
  { kind: "link", label: "Docs", href: links.docs },
  { kind: "link", label: "Changelog", href: links.changelog, id: "changelog" },
];
