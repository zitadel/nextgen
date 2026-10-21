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
 * The gradient for a seed: two different design-system starts at an angle,
 * all three taken from the hash, so a person keeps theirs on every screen and
 * device and two people rarely share one.
 */
export function avatarGradient(seed: string): string {
  const h = hash(seed);
  const from = h % STARTS.length;
  // The second colour is drawn from the other four, so the two never match.
  const to = (from + 1 + ((h >>> 8) % (STARTS.length - 1))) % STARTS.length;
  const angle = (h >>> 16) % 360;
  return `linear-gradient(${angle}deg, var(${STARTS[from]}) 15%, var(${STARTS[to]}) 85%)`;
}

/**
 * A person's avatar: a gradient generated from their user id rather than a
 * picture. The id, not the email, seeds it, so it survives a changed email.
 * A picture can replace it once users can upload one.
 *
 * Decorative: the name always sits beside it, so it is hidden from assistive
 * technology.
 */
export function UserAvatar({ seed, className }: { seed: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-6 shrink-0 rounded-full", className)}
      style={{ backgroundImage: avatarGradient(seed) }}
    />
  );
}
