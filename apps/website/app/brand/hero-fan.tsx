"use client";

import { useEffect, useRef, useState } from "react";

// zitadel/new-website's hero animation (public/cms/homepage-hero-opt.json):
// 217 frames at 30 a second, each a picture of the blades on the page's dark
// ground. Here as an H.264 video (hero-fan.mp4) over its first frame
// (hero-fan.avif, .hero-fan's background, so it paints with the page's
// styles), both from those frames a shade darker, so the ground is never
// lighter than the page's; .hero-fan drops it, on the dark by lightening and
// on the paper by inverting and darkening (globals.css). The first frame is
// light enough in bits (under 0.05 a pixel) that browsers leave it out of the
// largest paint, which stays the title. AGENTS.md has why a video and how to
// make one.

// Below a laptop, with less motion or with Save-Data, the first frame stays.
const WIDE = "(min-width: 1024px)";
const STILL = "(prefers-reduced-motion: reduce)";

type Connection = { saveData?: boolean };

/**
 * The blade fan: its first frame from the first paint, and on a wide screen
 * its loop once the page is idle, playing only while it is on screen. The
 * video lies over the frame in the same box, so nothing moves when it starts.
 */
export function HeroFan({ className = "" }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string>();
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if ((navigator as Navigator & { connection?: Connection }).connection?.saveData) {
      return;
    }
    const wide = matchMedia(WIDE);
    const still = matchMedia(STILL);
    // Safari has no idle callback: a moment after the first paint instead.
    const hasIdle = typeof window.requestIdleCallback === "function";
    let idle: number | undefined;
    const update = () => {
      if (wide.matches && !still.matches) {
        if (idle === undefined) {
          const load = () => setSrc(new URL("./hero-fan.mp4", import.meta.url).href);
          idle = hasIdle
            ? window.requestIdleCallback(load, { timeout: 2000 })
            : window.setTimeout(load, 300);
        }
      } else {
        setSrc(undefined);
        setPlaying(false);
      }
    };
    update();
    wide.addEventListener("change", update);
    still.addEventListener("change", update);
    return () => {
      wide.removeEventListener("change", update);
      still.removeEventListener("change", update);
      if (idle !== undefined) {
        if (hasIdle) {
          window.cancelIdleCallback(idle);
        } else {
          window.clearTimeout(idle);
        }
      }
    };
  }, []);

  // The loop, as the agency's player runs it, only while the fan is seen.
  useEffect(() => {
    const element = video.current;
    const target = box.current;
    if (!src || !element || !target) {
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        element.play().catch(() => {});
      } else {
        element.pause();
      }
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={box} aria-hidden="true" className={`hero-fan ${className}`}>
      {src && (
        <video
          ref={video}
          src={src}
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          className={`absolute inset-0 size-full transition-opacity duration-300 ${playing ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}
