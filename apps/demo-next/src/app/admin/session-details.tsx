"use client";

import { useEffect, useState } from "react";
import type { GetMySession200, GetMySession200FactorsItem } from "@zitadel/api/generated/model";

/**
 * Client component that fetches session details via the generated API client's
 * `getMySession()` and displays them as a summary table.
 */
export function SessionDetails() {
  const [session, setSession] = useState<GetMySession200 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { api } = await import("@/zitadel");
        const data = await api.getMySession();
        setSession(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch session");
      }
    })();
  }, []);

  if (error) {
    return <p style={{ color: "#ef4444", fontSize: "14px" }}>Session details: {error}</p>;
  }
  if (!session) {
    return <p style={{ color: "#9ca3af", fontSize: "14px" }}>Loading session details…</p>;
  }

  const rows: [string, string][] = [
    ["Session ID", session.session_id],
    ["Project ID", session.project_id],
    ["State", session.state],
    ["User ID", session.user_id ?? "—"],
    ["Created", new Date(session.created_at).toLocaleString()],
    ["Expires", new Date(session.expires_at).toLocaleString()],
  ];

  return (
    <div style={{ marginTop: "0" }}>
      <p style={{ color: "#6b7280", marginBottom: "24px" }}>
        {/* The fuller identity form: display with the identifier as its
            secondary, degrading down the ref chain when either is absent.
            The badge in the header renders the compact form of the same ref. */}
        Signed in as{" "}
        {session.user?.display
          ? `${session.user.display}${session.user.identifier ? ` (${session.user.identifier})` : ""}`
          : (session.user?.identifier ?? session.user_id ?? session.session_id)}
      </p>
      <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "12px" }}>Session details</h2>
      <table style={{ width: "100%", fontSize: "14px", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "6px 8px", color: "#6b7280", fontWeight: 500 }}>{label}</td>
              <td style={{ padding: "6px 8px", fontFamily: "monospace", wordBreak: "break-all" }}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {session.factors.length > 0 && (
        <>
          <h3 style={{ fontSize: "14px", fontWeight: 600, marginTop: "16px", marginBottom: "8px" }}>
            Verified factors
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: "14px" }}>
            {session.factors.map((f: GetMySession200FactorsItem, i: number) => (
              <li key={i} style={{ padding: "4px 0", color: "#374151" }}>
                <strong>{f.method}</strong>{" "}
                <span style={{ color: "#9ca3af" }}>
                  — {new Date(f.verified_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
