import { type HTMLAttributes, type JSX, type ReactNode } from "react";

import { cx } from "./utils.js";

/**
 * Paired React implementation of `<zl-page-shell>`. Full-bleed auth chrome with vertically
 * centred main content and footer attribution slot. The host page must not
 * impose its own background — the shell owns the surface colour so the
 * design tokens stay in charge.
 */
export interface PageShellProps extends HTMLAttributes<HTMLDivElement> {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function PageShell({ header, footer, children, className, ...rest }: PageShellProps): JSX.Element {
  return (
    <div {...rest} className={cx("zr-page-shell", className)}>
      {header ? <header className="zr-page-shell__header">{header}</header> : null}
      <main className="zr-page-shell__main">{children}</main>
      {footer ? <footer className="zr-page-shell__footer">{footer}</footer> : null}
    </div>
  );
}
