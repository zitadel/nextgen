"use client";

import { type FormEvent, useState } from "react";
import { createMockFlow, mockSubmit, type ZitadelAuthMode } from "@zitadel/sdk-core";
import { styles } from "./styles";

export function ZitadelAuthMock({ mode, title }: { mode: ZitadelAuthMode; title?: string }) {
  const flow = createMockFlow(mode);
  const [result, setResult] = useState<string | undefined>();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = mockSubmit(mode, values);
    setResult(response.message);
  }

  return (
    <main style={styles.shell}>
      <section style={styles.panel} data-zitadel-auth={mode} data-zitadel-source="mock">
        <div style={styles.header}>
          <p style={styles.eyebrow}>Zitadel mock auth</p>
          <h1 style={styles.title}>{title ?? flow.title}</h1>
        </div>
        {result ? (
          <div role="status" style={styles.success}>
            {result}
          </div>
        ) : (
          <form onSubmit={onSubmit} style={styles.form}>
            {flow.fields.map((field) => (
              <label key={field.name} style={styles.label}>
                <span>{field.label}</span>
                <input name={field.name} type={field.type} required={field.required} style={styles.input} />
              </label>
            ))}
            <div style={styles.actions}>
              {flow.actions.map((action, index) => (
                <button key={action} type="submit" style={index === 0 ? styles.primaryButton : styles.secondaryButton}>
                  {action}
                </button>
              ))}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
