import Image from "next/image";
import hero from "./hero.avif";
import heroStill from "./hero-still.webp";
import { Stage } from "./stage";
import logo from "./zitadel-logo.svg";

// The other apps on the cloud's host, and the code. Plain links, not
// next/link: each app is a deployment of its own, which this one must not
// prefetch.
const links = [
  { href: "/docs", label: "Docs" },
  { href: "/ui/console/", label: "Console" },
  { href: "/storybook/", label: "Storybook" },
  { href: "https://github.com/zitadel/nextgen", label: "GitHub" },
];

// The website's homepage hero (AGENTS.md): animated, or its first frame for
// reduced motion and for browsers without AVIF. Decoration, so no alt text.
function Hero({ className, first = false }: { className: string; first?: boolean }) {
  return (
    <picture className={className}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={heroStill.src} />
      <source type="image/avif" srcSet={hero.src} />
      <Image
        src={heroStill}
        alt=""
        unoptimized
        loading="eager"
        fetchPriority={first ? "high" : undefined}
        className="size-full"
      />
    </picture>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col overflow-hidden">
      <header className="mx-auto w-full max-w-6xl px-6 pt-8">
        <Image src={logo} alt="Zitadel" className="h-7 w-auto" loading="eager" />
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        <Stage>
          <div className="stage-frame">
            <Hero className="stage-glow" />
            <Hero className="stage-art" first />
          </div>
          <h1 className="stage-caption">Coming soon</h1>
        </Stage>
      </main>

      <footer className="px-6 pb-8">
        <nav
          aria-label="Elsewhere"
          className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-text-muted"
        >
          {links.map(({ href, label }) => (
            <a key={href} href={href} className="transition-colors hover:text-text-primary">
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </div>
  );
}
