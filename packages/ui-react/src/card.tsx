import { type HTMLAttributes, type JSX, type ReactNode } from "react";

import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-card>`. Header / body / footer regions are stacked
 * with the same Figma spacing as the Lit atom; max width is the
 * `container.auth-card` token.
 */
export interface CardProps extends HTMLAttributes<HTMLElement> {
  header?: ReactNode;
  footer?: ReactNode;
  compact?: boolean;
  children: ReactNode;
}

export function Card({ header, footer, compact = false, children, className, ...rest }: CardProps): JSX.Element {
  return (
    <section {...rest} className={cx("zr-card", compact && "zr-card--compact", className)}>
      {header ? <header className="zr-card__header">{header}</header> : null}
      <div className="zr-card__body">{children}</div>
      {footer ? <footer className="zr-card__footer">{footer}</footer> : null}
    </section>
  );
}
