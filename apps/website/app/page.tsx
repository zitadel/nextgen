import Image from "next/image";
import { Fragment } from "react";
import { CopyButton } from "./copy-button";
import hero from "./hero.avif";
import heroStill from "./hero-still.webp";
import { Logo } from "./logo";
import { Stage } from "./stage";

// The local preview with the published CLI, as the docs' quickstart runs it
// (AGENTS.md).
const commands = [
  "mkdir my-app && cd my-app",
  "npx @zitadel/cli@alpha start",
  "npx @zitadel/cli@alpha setup --server local",
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
    <main className="flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6 py-8">
      <Stage>
        <Logo className="stage-logo" />
        <div className="stage-frame">
          <Hero className="stage-glow" />
          <Hero className="stage-art" first />
        </div>
        <h1 className="stage-caption">Coming soon</h1>
      </Stage>
      <figure className="teaser mt-6 flex max-w-full flex-col items-center gap-3">
        <figcaption className="text-center text-text-secondary">
          Until then, try it locally:
        </figcaption>
        <div className="relative max-w-full rounded-2xl border border-border-primary">
          {/* A line too long for a phone wraps between words, never after the
              hyphens or slashes inside one, and under its command, not its $.
              The first leaves room for the copy button at its end. */}
          <pre className="whitespace-pre-wrap px-4 py-4 font-mono text-xs leading-6 sm:px-5 sm:text-sm">
            <code>
              {commands.map((command) => (
                <span key={command} className="block pl-[2ch] -indent-[2ch] first:pr-7">
                  <span aria-hidden="true" className="select-none text-text-muted">
                    {"$ "}
                  </span>
                  {command.split(" ").map((word, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the words of a fixed command, never reordered
                    <Fragment key={index}>
                      {index > 0 && " "}
                      <span className="whitespace-nowrap">{word}</span>
                    </Fragment>
                  ))}
                </span>
              ))}
            </code>
          </pre>
          <CopyButton text={commands.join("\n")} label="Copy the commands" />
        </div>
      </figure>
    </main>
  );
}
