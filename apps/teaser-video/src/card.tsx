import type { CSSProperties, ReactNode, Ref } from "react";
import type { ZlAccount } from "@zitadel/components/atoms";

// A step of the login as the default template
// (packages/components/src/orchestrator/templates/default.liquid) lays it
// out, in its English copy: the account it signs in to, the header, the
// fields, the actions and the line under them.

export const ADA = "ada@zitadel.com";

export function Card({
  title,
  subtitle,
  account,
  accountRef,
  accountStyle,
  fields,
  actions,
  nav,
}: {
  title: string;
  subtitle?: string;
  /**
   * The account chip, shown once the visitor has named the account: Ada's,
   * or the identifier given.
   */
  account?: boolean | string;
  /** The account chip itself, for a shot that measures or styles it. */
  accountRef?: Ref<ZlAccount>;
  /** Custom properties set on the account chip, which its avatar inherits. */
  accountStyle?: Record<string, string>;
  fields?: ReactNode;
  actions?: ReactNode;
  nav?: { lead: string; link: string };
}) {
  return (
    <zl-card style={{ width: "var(--zl-container-auth-card)" }}>
      <h3 slot="header" className="zl-card-title">
        {title}
      </h3>
      {subtitle && (
        <p slot="header" className="zl-card-subtitle">
          {subtitle}
        </p>
      )}
      {account && (
        <zl-account
          ref={accountRef}
          style={accountStyle as CSSProperties}
          identifier={typeof account === "string" ? account : ADA}
          avatar
        />
      )}
      {fields && <div className="zl-field-group">{fields}</div>}
      <div className="zl-card-actions">
        {actions}
        {nav && (
          <p className="zl-card-nav">
            {nav.lead}
            <span className="zl-card-nav__link">{nav.link}</span>
          </p>
        )}
      </div>
    </zl-card>
  );
}

export const SIGN_UP = { lead: "Don't have an account? ", link: "Sign up" };
export const SIGN_IN = { lead: "Already have an account? ", link: "Sign in" };
