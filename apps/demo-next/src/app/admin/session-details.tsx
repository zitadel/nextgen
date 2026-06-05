"use client";

import { useEffect, useState } from "react";

interface SessionInfo {
  userId: string;
}

/**
 * Client component that fetches the current session details via the
 * generated API client's `getMySession()`. The browser sends the
 * `__nextgen_session` cookie automatically through the `/__nextgen` proxy.
 */
export function SessionDetails() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { api } = await import("@/zitadel");
        const data = await api.getMySession();
        setSession({
          userId: data.user_id ?? data.session_id,
        });
      } catch {
        // Session fetch failed
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <span style={{ color: "#9ca3af" }}>Loading…</span>;
  if (!session) return <span>unknown</span>;

  return <span>{session.userId}</span>;
}
