// zitadel-cli: managed-file v1
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create account" };

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
