import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  LoaderCircle,
  type LucideIcon,
  Plus,
  TriangleAlert,
  User,
  X,
} from "lucide-react";
import { forwardRef, type SVGAttributes } from "react";

import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-icon>`. Renders the same curated Lucide-backed set
 * as the Lit atom. Sizes follow the Figma `16 | 24` matrix. Colour is
 * inherited via `currentColor` by default; set `tone` to use the
 * semantic icon tokens (`--zl-color-icon-{error|success|disabled}`).
 *
 * The Lit source in `packages/components/src/atoms/zl-icon.ts` is the
 * visual reference; keep the {@link IconName} union and the registry
 * mapping below mirrored when adding a glyph.
 *
 * Accessibility: glyphs with an entry in {@link DEFAULT_LABELS} expose
 * an `aria-label` so they're meaningful standalone. When the icon is
 * purely decorative (e.g. sitting next to a visible button label),
 * pass `decorative` to force `aria-hidden` + `role="presentation"` and
 * prevent the icon's name from leaking into the parent's accessible
 * name (e.g. avoid "Loading Loading" on a loading button).
 */
export type IconName =
  | "plus"
  | "arrow-right"
  | "arrow-left"
  | "spinner"
  | "check"
  | "cross"
  | "warning"
  | "alert-circle"
  | "info"
  | "passkey"
  | "user"
  | "eye"
  | "eye-off";

export type IconSize = "16" | "24";

export type IconTone = "default" | "error" | "success" | "disabled";

export interface IconProps extends Omit<SVGAttributes<SVGSVGElement>, "name"> {
  name: IconName;
  size?: IconSize;
  tone?: IconTone;
  spin?: boolean;
  decorative?: boolean;
  label?: string;
}

const REGISTRY: Record<IconName, LucideIcon> = {
  plus: Plus,
  "arrow-right": ArrowRight,
  "arrow-left": ArrowLeft,
  spinner: LoaderCircle,
  check: Check,
  cross: X,
  warning: TriangleAlert,
  "alert-circle": CircleAlert,
  info: Info,
  passkey: KeyRound,
  user: User,
  eye: Eye,
  "eye-off": EyeOff,
};

const DEFAULT_LABELS: Partial<Record<IconName, string>> = {
  spinner: "Loading",
  warning: "Warning",
  "alert-circle": "Alert",
  info: "Information",
  passkey: "Passkey",
  user: "User",
  eye: "Show",
  "eye-off": "Hide",
};

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = "24", tone = "default", spin = false, decorative = false, label, className, ...rest },
  ref,
) {
  const Glyph = REGISTRY[name];
  const ariaLabel = label ?? DEFAULT_LABELS[name];
  const hidden = decorative || !ariaLabel;
  return (
    <span
      className={cx(
        "zr-icon",
        `zr-icon--${size}`,
        tone !== "default" && `zr-icon--tone-${tone}`,
        spin && "zr-icon--spin",
        className,
      )}
    >
      <Glyph
        {...rest}
        ref={ref}
        role={hidden ? "presentation" : "img"}
        aria-hidden={hidden ? "true" : undefined}
        aria-label={hidden ? undefined : ariaLabel}
      />
    </span>
  );
});
