"use client";

import { useEffect, useState } from "react";
import { getMySession } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen";

/**
 * Client component that fetches session state using the generated
 * `getMySession` operation. The `<zitadel-logout>` component on the same
 * page calls `setApiBaseUrl("/__nextgen")` in its `connectedCallback`,
 * so the generated client already points at the proxy.
 */
export function SessionDisplay() {
  const [sessionState, setSessionState] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    getMySession({ credentials: "include" })
      .then((data) => setSessionState(data as unknown as Record<string, unknown>))
      .catch(() => setSessionState(null));
  }, []);

  if (!sessionState) return null;

  return (
    <>
      <h2 style={{ fontSize: "16px", fontWeight: 600, marginTop: "24px" }}>Session state</h2>
      <pre
        style={{
          background: "#f3f4f6",
          padding: "16px",
          borderRadius: "8px",
          fontSize: "12px",
          overflowX: "auto",
        }}
      >
        {JSON.stringify(sessionState, null, 2)}
      </pre>
    </>
  );
}
