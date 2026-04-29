"use client";

import type { ZitadelFlowPurpose, ZitadelRuntime } from "@zitadel/sdk-core";
import { styles } from "./styles";

export function ZitadelFlowReal({
  purpose,
  runtime,
}: {
  purpose: ZitadelFlowPurpose;
  runtime: ZitadelRuntime;
}) {
  const title = purpose === "login" ? "Sign in" : "Create account";
  return (
    <main style={styles.shell}>
      <section style={styles.panel} data-zitadel-flow={purpose} data-zitadel-source="real">
        <div style={styles.header}>
          <p style={styles.eyebrow}>Zitadel</p>
          <h1 style={styles.title}>{title}</h1>
        </div>
        <p style={styles.dim}>
          Redirecting to {runtime.issuer ?? "Zitadel"}…
        </p>
        <p style={styles.dim}>
          Environment: {runtime.environment} · Project: {runtime.projectId}
        </p>
      </section>
    </main>
  );
}
