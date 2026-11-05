import type { ReactNode } from "react";

export const metadata = { title: "Orbit Notes" };

// The host app's own shell: setup must leave it untouched, and the widget
// posture's auth pages render inside it (ADR 044). The journey asserts this
// header is visible on /login.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>Orbit Notes</strong>
          <nav>
            <a href="/">Home</a>
            <a href="/login">Sign in</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
