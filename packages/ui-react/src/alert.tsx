import { type HTMLAttributes, type JSX, type ReactNode } from "react";

import { Icon, type IconName } from "./icon.js";
import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-alert>`. Visual spec lives in the Lit atom — this pair
 * carries the same per-severity icon/colour mapping and aria semantics. See
 * `packages/components/src/atoms/zl-alert.ts` for the Figma node lineage
 * and per-state values.
 */
export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  severity?: "error" | "success" | "warning" | "info";
  heading?: string;
  dismissible?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}

const ICON_FOR_SEVERITY: Record<NonNullable<AlertProps["severity"]>, IconName> = {
  error: "alert-circle",
  warning: "alert-circle",
  success: "check",
  info: "info",
};

export function Alert({
  severity = "error",
  heading,
  dismissible = false,
  onDismiss,
  children,
  className,
  ...rest
}: AlertProps): JSX.Element {
  return (
    <div
      {...rest}
      className={cx("zr-alert", `zr-alert--${severity}`, className)}
      role={severity === "error" ? "alert" : "status"}
      aria-live={severity === "error" ? "assertive" : "polite"}
    >
      <Icon className="zr-alert__icon" name={ICON_FOR_SEVERITY[severity]} size="16" />
      <div className="zr-alert__body">
        {heading ? <span className="zr-alert__title">{heading}</span> : null}
        <div className="zr-alert__message">{children}</div>
      </div>
      {dismissible ? (
        <button
          type="button"
          className="zr-alert__close"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <Icon name="cross" size="16" decorative />
        </button>
      ) : null}
    </div>
  );
}
