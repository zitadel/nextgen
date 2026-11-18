// zitadel-cli: managed-file v1
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sign in" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
