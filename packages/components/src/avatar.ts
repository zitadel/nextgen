/**
 * The generated avatar, shared by `<zl-avatar>` and the console so the two
 * paint the same person the same way. Lit-free: the console imports it as
 * `@zitadel/components/avatar` and paints with `avatar.css`.
 */

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

/** The custom properties `.zl-avatar` (`avatar.css`) paints with. */
export type AvatarVars = Record<
  "--avatar-from" | "--avatar-to" | "--avatar-base" | "--avatar-phase",
  string
>;

/**
 * The colours for a seed: two different design-system starts, the angle the
 * gradient starts at and where in its motion it starts, all taken from the
 * hash, so a person keeps theirs on every screen and device and two people
 * rarely share one.
 *
 * The seed is trimmed and lowercased first, so `Maya@Example.com ` as typed at
 * sign-in paints the same as the stored `maya@example.com`. Set on a hover
 * host as well, the variables tint it with the same colours.
 */
export function avatarVars(seed: string): AvatarVars {
  const h = hash(seed.trim().toLowerCase());
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
  };
}

/**
 * What a person's avatar is generated from: their identifier, because that is
 * all the login widget can know. Its password step echoes what the visitor
 * typed whether or not the account exists, so a gradient from that string
 * leaks nothing, where a user id would confirm the account and expose an
 * internal id. The cost: a changed email changes the avatar. The user id
 * stands in only where no identifier is known.
 */
export function avatarSeed(user: { userId?: string; identifier?: string } | undefined): string {
  return user?.identifier?.trim() || user?.userId || "";
}

/**
 * Registers the angles `avatar.css` animates, so they interpolate. A
 * document-level `@property` rule does the same, but one inside a shadow root
 * is ignored, so `<zl-avatar>` registers them from script. Registering twice
 * throws; the first registration stands.
 */
export function registerAvatarProperties(): void {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  for (const name of ["--avatar-turn", "--avatar-sway-a", "--avatar-sway-b"]) {
    try {
      CSS.registerProperty({ name, syntax: "<angle>", inherits: false, initialValue: "0deg" });
    } catch {
      // Already registered.
    }
  }
}
