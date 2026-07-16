import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

import { Icon } from "./icon.js";
import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-checkbox>`.
 * Visual spec: Figma Checkbox `4387:460` / Checkbox / With Label `6634:1868`
 * in `8UjCXw8yemgljmbkWGrSfE`. Outline = unchecked, Filled = checked; the
 * hover / focus / pressed halo and disabled treatment are driven by CSS
 * pseudo-classes on the shared `.zr-checkbox` surface.
 */
export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Visible label; when omitted, pass `aria-label` or `children` for an accessible name. */
  label?: ReactNode;
  /** Inline validation message shown under the row (empty = none). */
  error?: ReactNode;
  /** Force the invalid (red-edge) treatment without an `error` string. */
  invalid?: boolean;
  /**
   * Playground-only forced interaction state (`hovered` | `focused` | `pressed`).
   * Mirrors the Figma matrix; not part of the product API.
   */
  previewState?: "hovered" | "focused" | "pressed";
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, invalid = false, previewState, className, disabled, children, id, "aria-label": ariaLabel, ...rest },
  ref,
) {
  const isDisabled = disabled === true;
  const showError = Boolean(error);
  const errorId = id ? `${id}-error` : undefined;
  return (
    <div className="zr-checkbox-field">
      <label
        className={cx(
          "zr-checkbox",
          (invalid || showError) && "zr-checkbox--invalid",
          isDisabled && "zr-checkbox--disabled",
          className,
        )}
        data-state={previewState}
      >
        <input
          {...rest}
          ref={ref}
          id={id}
          type="checkbox"
          className="zr-checkbox__input"
          disabled={disabled}
          aria-label={label ? undefined : ariaLabel}
          aria-invalid={invalid || showError ? "true" : "false"}
          aria-describedby={showError ? errorId : undefined}
        />
        <span className="zr-checkbox__box">
          <span className="zr-checkbox__face">
            <Icon className="zr-checkbox__check" name="check" size="16" decorative />
          </span>
        </span>
        {label !== undefined ? <span className="zr-checkbox__label">{label}</span> : children}
      </label>
      <div className="zr-checkbox__error" id={errorId} role="alert" hidden={!showError}>
        {error}
      </div>
    </div>
  );
});
