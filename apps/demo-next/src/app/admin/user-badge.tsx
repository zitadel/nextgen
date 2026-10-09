"use client";

import { useAuth } from "@zitadel/sdk-next/react";

/**
 * Client component reading the auth state seeded by NextgenProvider in the
 * root layout. The hook returns the client-safe identity only — the raw
 * session token never reaches client code.
 */
export function UserBadge() {
  const auth = useAuth();

  if (!auth.isAuthenticated) {
    return <span style={{ color: "#9ca3af", fontSize: "14px" }}>Signed out</span>;
  }

  return (
    <span
      style={{
        background: "#e5e7eb",
        borderRadius: "9999px",
        padding: "4px 12px",
        fontSize: "14px",
        color: "#374151",
      }}
    >
      {auth.session.display ?? auth.session.identifier ?? auth.session.userId}
    </span>
  );
}
