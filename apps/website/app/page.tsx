import Image from "next/image";
import hero from "./hero.avif";
import heroStill from "./hero-still.webp";
import { Logo } from "./logo";
import { Stage } from "./stage";

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
    </main>
  );
}
