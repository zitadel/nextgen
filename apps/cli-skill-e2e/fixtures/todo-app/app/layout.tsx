import Link from "next/link";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata = { title: "Todos", description: "A small team todo list" };

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <Link href="/">Home</Link>
          <Link href="/todos">Todos</Link>
          <Link href="/about">About</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
