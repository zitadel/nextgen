"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import styles from "./brand-preview.module.css";
import { type BrandChoice, baseProperties, paintedProperties } from "./brand-tokens";
import { Logo } from "./logo";

// How far below the viewport the preview may still be when the atoms start
// loading, so they are there by the time it scrolls in.
const LOAD_MARGIN = "600px";

/**
 * The first step of the default login, sign-in by email, built from the atoms
 * of @zitadel/components, the product's own UI code, under the --zl-*
 * properties the visitor's choices set. The atoms load once the preview nears
 * the viewport; until then, and if they cannot load, it says so instead.
 * Nothing submits: there is no server behind it.
 */
export function BrandPreview({ choice }: { choice: BrandChoice }) {
  const [base, setBase] = useState<Record<string, string>>();
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        // The first import defines the custom elements; the second holds the
        // design system's defaults.
        Promise.all([
          import("@zitadel/components/atoms"),
          import("@zitadel/components/tokens"),
        ]).then(
          ([, { tokens, cssVars }]) => {
            if (!cancelled) {
              setBase(baseProperties(tokens, cssVars));
            }
          },
          () => {
            if (!cancelled) {
              setFailed(true);
            }
          },
        );
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  const style = base && ({ ...base, ...paintedProperties(choice) } as CSSProperties);

  return (
    <div ref={root} className={styles.preview} style={style}>
      {base ? (
        <div className={styles.stack}>
          {/* The identifier step as the default template renders it, in its
              English copy (packages/components/src/orchestrator). */}
          <zl-card>
            <h3 slot="header" className="zl-card-title">
              Sign in
            </h3>
            <p slot="header" className="zl-card-subtitle">
              Enter your email to continue
            </p>
            <div className="zl-field-group">
              <zl-field
                label="Email"
                type="email"
                placeholder="you@example.com"
                autocomplete="off"
              />
            </div>
            <div className="zl-card-actions">
              <zl-button hierarchy="primary" size="medium" type="button" label="Continue" block />
              <zl-button
                hierarchy="secondary"
                size="medium"
                type="button"
                label="Sign in with a passkey"
                block
              />
              <p className="zl-card-nav">
                Don&apos;t have an account?{" "}
                <button type="button" className="zl-card-nav__link">
                  Sign up
                </button>
              </p>
            </div>
          </zl-card>
          <p className={styles.trustmark}>
            Secured with <Logo id="preview-logo" />
          </p>
        </div>
      ) : (
        <p className={styles.status} role="status">
          {failed ? "The components could not be loaded." : "Loading the components…"}
        </p>
      )}
    </div>
  );
}
