import { links } from "./links";
import { Logo } from "./logo";

const footerLinks = [
  { href: links.docs, text: "Docs" },
  { href: links.quickstart, text: "Quickstart" },
  { href: links.storybook, text: "Components" },
  { href: links.github, text: "GitHub" },
  { href: "/llms.txt", text: "llms.txt" },
  { href: links.zitadel, text: "Zitadel v4" },
];

export function SiteFooter() {
  return (
    <footer className="border-border-primary border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 md:flex-row md:justify-between">
        <div className="flex max-w-sm flex-col gap-4">
          <Logo id="footer-logo" className="h-6 w-auto self-start" />
          <p className="text-sm text-text-secondary leading-6">
            The next generation of Zitadel, in developer preview. Its APIs, CLI flags and packages
            still change: for production, use Zitadel v4.
          </p>
        </div>
        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm sm:grid-cols-3">
            {footerLinks.map(({ href, text }) => (
              <li key={href}>
                <a
                  href={href}
                  className="rounded-sm text-text-secondary transition-colors hover:text-text-primary"
                >
                  {text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
