import { type CSSProperties, useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * The gradient starts the design system ships (`--zl-gradient-*-start`), in a
 * fixed order: a seed's colours depend on this list, so append, never reorder.
 */
const STARTS = [
  "--zl-gradient-red-start",
  "--zl-gradient-purple-start",
  "--zl-gradient-lavender-start",
  "--zl-gradient-rose-start",
  "--zl-gradient-neutral-start",
] as const;

/** FNV-1a, 32-bit: a small, stable hash; nothing here needs it to be secret. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The colours for a seed, as the custom properties `.user-avatar` paints with
 * (`styles.css`): two different design-system starts, the angle it starts at
 * and where in its motion it starts, all taken from the hash, so a person keeps theirs on every
 * screen and device and two people rarely share one.
 *
 * Set on a hover host as well, they tint its hover wash with the same colours.
 */
export function avatarVars(seed: string): CSSProperties {
  const h = hash(seed);
  const from = h % STARTS.length;
  // The second colour is drawn from the other four, so the two never match.
  const to = (from + 1 + ((h >>> 8) % (STARTS.length - 1))) % STARTS.length;
  return {
    "--avatar-from": `var(${STARTS[from]})`,
    "--avatar-to": `var(${STARTS[to]})`,
    "--avatar-base": `${(h >>> 16) % 360}deg`,
    // A negative delay starts the motion part-way through. The three
    // periods (18, 26 and 60s) only line up again after over an hour.
    "--avatar-phase": `-${(h >>> 4) % 1200}s`,
  } as CSSProperties;
}

/** How much faster the gradient moves while the avatar's host is hovered. */
const FAST = 4;

/** How long the gradient takes to ease from one speed to the other. */
const EASE_MS = 3000;

function setRate(element: HTMLElement | null, rate: number) {
  for (const animation of element?.getAnimations?.() ?? []) animation.updatePlaybackRate(rate);
}

/**
 * A person's avatar: a gradient generated from their user id rather than a
 * picture. The id, not the email, seeds it, so it survives a changed email.
 * A picture can replace it once users can upload one.
 *
 * Its gradient's direction wanders, unless the person asked for reduced
 * motion. With `fast` it moves `FAST` times quicker: the playback rate
 * changes, not the duration, so the motion speeds up from where it is instead
 * of jumping. Either way the speed eases over `EASE_MS` rather than switching,
 * so it picks up like something pushed and coasts back to rest.
 *
 * Decorative: the name always sits beside it, so it is hidden from assistive
 * technology.
 */
export function UserAvatar({
  seed,
  fast = false,
  className,
}: {
  seed: string;
  fast?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  // The rate the animations run at now, so a slow-down starts from it.
  const rate = useRef(1);
  useEffect(() => {
    const target = fast ? FAST : 1;
    if (rate.current === target) return;
    // From wherever the last change left it, so a quick hover in and out
    // turns round smoothly.
    const from = rate.current;
    let start: number | undefined;
    let frame = requestAnimationFrame(function step(now) {
      start ??= now;
      const t = Math.min((now - start) / EASE_MS, 1);
      // Ease out: most of the change comes early, the last of it slowly.
      rate.current = target + (from - target) * (1 - t) ** 2;
      setRate(ref.current, rate.current);
      if (t < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [fast]);

  return (
    <span
      ref={ref}
      aria-hidden
      className={cn("user-avatar size-6 shrink-0 rounded-full", className)}
      style={avatarVars(seed)}
    />
  );
}
