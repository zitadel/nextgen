import { ZITADEL_ATTRIBUTION_LOGOTYPE_SVG } from "@zitadel-nextgen/shared-component-styles/attribution-markup";
import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";

import { cx } from "./utils.js";

/** Figma attribution chip label (`6593:141767`): "Secured with" + logotype. */
export function ZitadelAttributionPillLabel(): JSX.Element {
  return (
    <>
      Secured with{" "}
      <span
        className="zr-pill__logotype"
        dangerouslySetInnerHTML={{ __html: ZITADEL_ATTRIBUTION_LOGOTYPE_SVG }}
      />
    </>
  );
}

/**
 * Paired React implementation of `<zl-pill>`. Renders an `<a>` when `href` is supplied
 * (used by the "Secured with Zitadel" footer chip) and a `<span>`
 * otherwise. Tone matches the Figma subtitle palette.
 */
export interface PillProps {
  tone?: "neutral" | "pink" | "purple" | "orange" | "success";
  href?: string;
  children: ReactNode;
  className?: string;
}

type SpanRest = Omit<HTMLAttributes<HTMLSpanElement>, keyof PillProps>;
type AnchorRest = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof PillProps>;

export function Pill({
  tone = "neutral",
  href,
  children,
  className,
  ...rest
}: PillProps & SpanRest & AnchorRest): JSX.Element {
  const classes = cx("zr-pill", tone !== "neutral" && `zr-pill--${tone}`, className);
  if (href) {
    return (
      <a {...(rest as AnchorRest)} href={href} rel="noopener noreferrer" className={classes}>
        {children}
      </a>
    );
  }
  return (
    <span {...(rest as SpanRest)} className={classes}>
      {children}
    </span>
  );
}
