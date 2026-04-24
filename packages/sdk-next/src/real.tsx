"use client";

import type { ZitadelAuthMode, ZitadelRuntime } from "@zitadel/sdk-core";
import { styles } from "./styles";

export function ZitadelAuthReal({
  mode,
  title,
  runtime,
}: {
  mode: ZitadelAuthMode;
  title?: string;
  runtime: ZitadelRuntime;
}) {
  return (
    <main style={styles.shell}>
      <section style={styles.panel} data-zitadel-auth={mode} data-zitadel-source="real">
        <div style={styles.header}>
          <p style={styles.eyebrow}>Zitadel</p>
          <h1 style={styles.title}>{title ?? (mode === "login" ? "Sign in" : "Create account")}</h1>
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
