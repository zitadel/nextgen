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
const FAST = 8;

/**
 * A person's avatar: a gradient generated from their user id rather than a
 * picture. The id, not the email, seeds it, so it survives a changed email.
 * A picture can replace it once users can upload one.
 *
 * Its gradient's direction wanders, unless the person asked for reduced
 * motion. With `fast` it moves `FAST` times quicker: the playback rate
 * changes, not the duration, so the motion speeds up from where it is instead
 * of jumping.
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
  useEffect(() => {
    for (const animation of ref.current?.getAnimations?.() ?? []) {
      animation.updatePlaybackRate(fast ? FAST : 1);
    }
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
