import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";

import { avatarVars } from "../avatar.js";
import avatarSurfaceStyles from "../styles/avatar.css?inline";
import avatarStyles from "./zl-avatar.css?inline";

import type { AtomManifest } from "../manifest.js";
import { surfaceStyles } from "../styles/index.js";

/**
 * Registers the angles `avatar.css` animates, so they interpolate. A
 * document-level `@property` rule does the same, but one inside a shadow root
 * is ignored, so the atom registers them from script. Registering twice
 * throws; the first registration stands.
 */
function registerAvatarProperties(): void {
  if (typeof CSS === "undefined" || typeof CSS.registerProperty !== "function") return;
  for (const name of ["--zl-avatar-turn", "--zl-avatar-sway-a", "--zl-avatar-sway-b"]) {
    try {
      CSS.registerProperty({ name, syntax: "<angle>", inherits: false, initialValue: "0deg" });
    } catch {
      // Already registered.
    }
  }
}

registerAvatarProperties();

/**
 * Atom: `<zl-avatar>` — a person's generated avatar, the gradient the console
 * shows for the same identifier (`src/avatar.ts`).
 *
 * Values:
 *
 *   size        24px (`--zl-spacing-6`); a template resizes the host
 *   radius      full
 *   surface     two `--zl-gradient-*-start` colours picked from `seed`
 *
 * `seed` is what the visitor typed, never a user id: the login must not
 * confirm that an account exists. Its direction wanders unless the visitor
 * asked for reduced motion.
 *
 * Decorative: the identifier always sits beside it, so it is hidden from
 * assistive technology.
 */
@customElement("zl-avatar")
export class ZlAvatar extends LitElement {
  static override styles = surfaceStyles(avatarSurfaceStyles, avatarStyles);

  @property() accessor seed = "";

  override render() {
    return html`<span
      class="zl-avatar"
      part="avatar"
      aria-hidden="true"
      style=${styleMap(avatarVars(this.seed))}
    ></span>`;
  }
}

export const zlAvatarManifest: AtomManifest = {
  tag: "zl-avatar",
  attrs: ["seed"],
  parts: ["avatar"],
  slots: [],
  events: [],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-avatar": ZlAvatar;
  }
}
