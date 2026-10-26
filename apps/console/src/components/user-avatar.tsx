import { type CSSProperties, useEffect, useRef } from "react";

import { avatarVars as sharedAvatarVars } from "@zitadel/components/avatar";

import { cn } from "@/lib/utils";

export { avatarSeed } from "@zitadel/components/avatar";

/**
 * The colours for a seed (`@zitadel/components/avatar`, shared with the
 * login's `<zl-avatar>`), as React style. Set on a hover host as well, they
 * tint its hover wash with the same colours.
 */
export function avatarVars(seed: string): CSSProperties {
  return sharedAvatarVars(seed) as CSSProperties;
}

/** How much faster the gradient moves while the avatar's host is hovered. */
const FAST = 4;

/** How long the gradient takes to ease from one speed to the other. */
const EASE_MS = 3000;

function setRate(element: HTMLElement | null, rate: number) {
  for (const animation of element?.getAnimations?.() ?? []) animation.updatePlaybackRate(rate);
}

/**
 * A person's avatar: a gradient generated from their identifier
 * (`avatarSeed`) rather than a picture, painted by the shared `.zl-avatar`
 * rules, so it is the one the login shows. A picture can replace it once
 * users can upload one.
 *
 * It moves: `zl-avatar-moving` opts into the shared drift of the gradient's
 * direction (`@zitadel/components/avatar.css`).
 *
 * With `fast` it moves `FAST` times quicker: the playback rate
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
      className={cn("zl-avatar zl-avatar-moving size-6 shrink-0", className)}
      style={avatarVars(seed)}
    />
  );
}
