import { CommandLine } from "./command-line";
import { startCommand } from "./commands";
import { links } from "./links";
import { Logo } from "./logo";
import { ThemeSwitch } from "./theme-toggle";

const COLUMNS = [
  {
    title: "Get started",
    links: [
      { label: "Quickstart", href: links.quickstart },
      { label: "Documentation", href: links.docs },
      { label: "llms.txt", href: links.llms },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: links.github },
      { label: "Issues", href: links.issues },
      { label: "Changelog", href: links.changelog },
      { label: "Pricing", href: links.pricing },
      { label: "zitadel.com", href: links.zitadel },
    ],
  },
];

/**
 * The page's end: the logo with the line it stands for and the command that
 * starts Zitadel, to copy on the way out, beside the ways on into the docs
 * and the project; under them what this preview is, and the theme switch
 * with System (theme-toggle.tsx).
 */
export function SiteFooter() {
  return (
    <footer className="border-border-primary border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 md:grid-cols-[1fr_auto] md:gap-16 md:py-16">
        <div className="flex max-w-sm flex-col items-start gap-4">
          <a href="/" aria-label="Zitadel preview home" className="rounded-sm">
            <Logo id="footer-logo" className="h-6 w-auto" autoplay />
          </a>
          <p className="text-sm text-text-muted leading-6">
            Open-source auth that lives in your repo.
          </p>
          <div className="mt-1 rounded-lg border border-window-border bg-window px-3 py-1 font-mono text-xs leading-7">
            <CommandLine command={startCommand} placement="footer" />
          </div>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-16 gap-y-8 text-sm">
          {COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h2 className="font-mono text-text-muted text-xs leading-4">{column.title}</h2>
              <ul className="flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      className="text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-border-primary border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <p className="font-mono text-text-muted text-xs leading-4">
            A preview of the next Zitadel: APIs, CLI flags and packages still change.
          </p>
          <ThemeSwitch />
        </div>
      </div>
    </footer>
  );
}
