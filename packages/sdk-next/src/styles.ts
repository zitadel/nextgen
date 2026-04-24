import type { CSSProperties } from "react";

export const styles = {
  shell: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 24,
    background: "#f7f8fa",
    color: "#17202a",
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  panel: {
    width: "min(100%, 420px)",
    border: "1px solid #d9dee7",
    borderRadius: 8,
    background: "#ffffff",
    padding: 24,
    boxShadow: "0 12px 32px rgba(23, 32, 42, 0.08)",
  },
  header: {
    display: "grid",
    gap: 6,
    marginBottom: 20,
  },
  eyebrow: {
    margin: 0,
    color: "#57708f",
    fontSize: 13,
    fontWeight: 600,
  },
  title: {
    margin: 0,
    fontSize: 28,
    lineHeight: 1.15,
    letterSpacing: 0,
  },
  form: {
    display: "grid",
    gap: 14,
  },
  label: {
    display: "grid",
    gap: 6,
    fontSize: 14,
    fontWeight: 600,
  },
  input: {
    minHeight: 42,
    border: "1px solid #cbd3df",
    borderRadius: 6,
    padding: "0 12px",
    font: "inherit",
  },
  actions: {
    display: "grid",
    gap: 10,
    marginTop: 8,
  },
  primaryButton: {
    minHeight: 42,
    border: "1px solid #17202a",
    borderRadius: 6,
    background: "#17202a",
    color: "#ffffff",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
  },
  secondaryButton: {
    minHeight: 42,
    border: "1px solid #cbd3df",
    borderRadius: 6,
    background: "#ffffff",
    color: "#17202a",
    font: "inherit",
    fontWeight: 700,
    cursor: "pointer",
  },
  success: {
    border: "1px solid #8fc8a5",
    borderRadius: 6,
    padding: 12,
    background: "#edf8f1",
    color: "#205136",
    fontWeight: 700,
  },
  dim: {
    color: "#57708f",
    fontSize: 13,
  },
} satisfies Record<string, CSSProperties>;
