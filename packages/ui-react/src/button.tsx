import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Icon } from "./icon.js";
import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-button>`.
 *
 * Axes match the Figma button spec at node `6598:292`:
 *   - hierarchy: primary | secondary | text
 *   - size:      medium (48px) | small (40px)
 *   - state:     enabled/hovered/focused/active/disabled — derived from the
 *                browser; `loading` swaps the trailing content for a spinner
 *                and disables the button (Figma shows the spinner trailing).
 *
 * Behaviour parity with the Lit atom:
 *   - When `block` is set the button stretches to its container.
 *   - `loading` implies `disabled`.
 *   - Click is suppressed while loading or disabled.
 *
 * `leading` / `trailing` slots accept any ReactNode — typically a
 * `<Icon name="..." size="..."/>`.
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  hierarchy?: "primary" | "secondary" | "text";
  size?: "medium" | "small";
  block?: boolean;
  loading?: boolean;
  label?: string;
  children?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    hierarchy = "primary",
    size = "medium",
    block = false,
    loading = false,
    disabled = false,
    label,
    children,
    leading,
    trailing,
    className,
    onClick,
    ...rest
  },
  ref,
) {
  const blocked = disabled || loading;
  const spinnerSize = size === "small" ? "16" : "24";
  const body = children ?? label;
  return (
    <button
      {...rest}
      ref={ref}
      className={cx(
        "zr-btn",
        `zr-btn--${hierarchy}`,
        `zr-btn--${size}`,
        block && "zr-btn--block",
        className,
      )}
      disabled={blocked}
      aria-busy={loading ? "true" : "false"}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
    >
      {leading}
      {body != null ? <span>{body}</span> : null}
      {loading ? <Icon name="spinner" size={spinnerSize} spin decorative /> : trailing}
    </button>
  );
});
